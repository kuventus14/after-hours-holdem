'use strict';
// 앱 모드 계정: 아이디·비밀번호·닉네임으로 가입하고, 로그인하면 세션 토큰을 준다.
//  - 비밀번호는 scrypt(솔트 포함)로만 저장한다. 세션 토큰은 해시만 저장해서 파일이 새도 로그인에 쓸 수 없다.
//  - 게임 안에서 쓰는 '플레이어 토큰'은 계정 번호에서 서버 비밀값으로 만든다(계정마다 늘 같아서 자리 복귀가 되고, 남이 알아낼 수 없다).
//  - shortcut: 파일 저장(users.json)이라 계정이 수천 명을 넘으면 DB 로 옮긴다. 비밀번호 찾기(이메일)는 아직 없다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { hasBad } = require('./filter');
const scrypt = promisify(crypto.scrypt);

const DAY = 86400e3;
const SESSION_REMEMBER = 90 * DAY, SESSION_SHORT = 1 * DAY;
const USER_RE = /^[a-z0-9_]{4,20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/;
const NICK_RE = /^[\p{L}\p{N}_\- ]{2,12}$/u;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

function createAuth(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const F = { users: path.join(dir, 'users.json'), sessions: path.join(dir, 'sessions.json'), secret: path.join(dir, 'secret.key'), reports: path.join(dir, 'reports.json') };
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const write = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o), { mode: 0o600 }); fs.renameSync(t, f); };
  let secret;
  try { secret = fs.readFileSync(F.secret); } catch { secret = crypto.randomBytes(32); fs.writeFileSync(F.secret, secret, { mode: 0o600 }); }

  const users = read(F.users, {});       // 계정번호 → { id, username, nickname, salt, hash, createdAt }
  const sessions = read(F.sessions, {}); // sha256(토큰) → { uid, exp }
  const byName = new Map(), byNick = new Map(), byEmail = new Map();
  const resets = new Map(); // sha256(재설정 토큰) → { uid, exp } (메모리만: 서버를 다시 켜면 무효, 30분짜리라 괜찮다)
  const index = () => { byName.clear(); byNick.clear(); byEmail.clear(); for (const u of Object.values(users)) { byName.set(u.username, u.id); byNick.set(u.nickname.toLowerCase(), u.id); if (u.email) byEmail.set(u.email, u.id); } };
  index();
  const now = () => Date.now();
  const saveUsers = () => write(F.users, users);
  const saveSessions = () => write(F.sessions, sessions);
  for (const [k, s] of Object.entries(sessions)) if (s.exp < now() || !users[s.uid]) delete sessions[k];
  // 개인정보처리방침과 같게: 신고 기록은 1년 지나면 지운다 (켤 때, 그리고 하루마다)
  const pruneReports = () => { const all = read(F.reports, null); if (!all) return; const keep = all.filter((r) => r.at > now() - 365 * DAY); if (keep.length !== all.length) write(F.reports, keep); };
  pruneReports(); setInterval(pruneReports, DAY).unref();

  // 시도 횟수 제한: 키(아이디·접속 주소)마다 시간 창 안의 횟수를 센다
  const hits = new Map();
  function limited(key, max, ms) {
    const t = now(), arr = (hits.get(key) || []).filter((x) => t - x < ms);
    if (arr.length >= max) { hits.set(key, arr); return true; }
    arr.push(t); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < ms)) hits.delete(k);
    return false;
  }
  const TOO_MANY = '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요';

  const hashPw = async (pw, salt) => scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  function newSession(uid, remember) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions[sha(token)] = { uid, exp: now() + (remember ? SESSION_REMEMBER : SESSION_SHORT) };
    saveSessions();
    return token;
  }
  const pub = (u) => ({ id: u.id, username: u.username, nickname: u.nickname });

  async function signup({ username, password, nickname, email, agree, remember, ip = '' }) {
    email = String(email || '').trim().toLowerCase();
    username = String(username || '').trim().toLowerCase(); nickname = String(nickname || '').trim().replace(/\s+/g, ' '); password = String(password || '');
    if (limited('su:' + ip, 20, 3600e3)) return { error: TOO_MANY };
    if (agree !== true) return { error: '만 17세 이상이며 개인정보처리방침에 동의해야 가입할 수 있어요' };
    if (!USER_RE.test(username)) return { error: '아이디는 영문 소문자·숫자·밑줄 4~20자예요' };
    if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 해요' };
    if (password.length > 64) return { error: '비밀번호는 64자 이하로 해 주세요' };
    if (!NICK_RE.test(nickname)) return { error: '닉네임은 2~12자예요 (글자·숫자·공백·_ - 만 쓸 수 있어요)' };
    if (!EMAIL_RE.test(email) || email.length > 120) return { error: '이메일 주소를 확인해 주세요' };
    if (hasBad(nickname)) return { error: '사용할 수 없는 닉네임이에요' };
    if (byName.has(username)) return { error: '이미 사용 중인 아이디예요' };
    if (byNick.has(nickname.toLowerCase())) return { error: '이미 사용 중인 닉네임이에요' };
    if (byEmail.has(email)) return { error: '이미 가입된 이메일이에요' };
    const salt = crypto.randomBytes(16), id = crypto.randomUUID();
    const hash = await hashPw(password, salt);
    if (byName.has(username) || byNick.has(nickname.toLowerCase()) || byEmail.has(email)) return { error: '이미 사용 중인 아이디예요' }; // 해시 계산 중에 같은 가입이 끝났을 때
    users[id] = { id, username, nickname, email, blocks: [], salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: now() };
    index(); saveUsers();
    return { token: newSession(id, !!remember), user: pub(users[id]) };
  }

  async function login({ username, password, remember, ip = '' }) {
    username = String(username || '').trim().toLowerCase(); password = String(password || '');
    if (limited('li:' + ip, 60, 600e3) || limited('lu:' + username, 10, 600e3)) return { error: TOO_MANY };
    const u = users[byName.get(username)];
    const salt = u ? Buffer.from(u.salt, 'hex') : Buffer.alloc(16); // 없는 아이디도 같은 시간이 걸리게 해서 아이디 존재 여부를 시간으로 알 수 없게 한다
    const hash = await hashPw(password.slice(0, 64), salt);
    if (!u || !safeEq(hash, Buffer.from(u.hash, 'hex'))) return { error: '아이디 또는 비밀번호가 맞지 않아요' };
    if (u.banned) return { error: '이용이 제한된 계정이에요' };
    return { token: newSession(u.id, !!remember), user: pub(u) };
  }

  function verify(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const k = sha(token), s = sessions[k];
    if (!s) return null;
    if (s.exp < now() || !users[s.uid]) { delete sessions[k]; saveSessions(); return null; }
    if (users[s.uid].banned) return null;
    return pub(users[s.uid]);
  }
  function logout(token) { if (typeof token !== 'string') return; const k = sha(token); if (sessions[k]) { delete sessions[k]; saveSessions(); } }

  // 앱스토어 규칙: 앱 안에서 계정을 지울 수 있어야 한다
  async function deleteAccount(token, password) {
    const u = verify(token); if (!u) return { error: '로그인이 필요해요' };
    if (limited('del:' + u.id, 5, 600e3)) return { error: TOO_MANY };
    const full = users[u.id], hash = await hashPw(String(password || '').slice(0, 64), Buffer.from(full.salt, 'hex'));
    if (!safeEq(hash, Buffer.from(full.hash, 'hex'))) return { error: '비밀번호가 맞지 않아요' };
    delete users[u.id];
    for (const [k, s] of Object.entries(sessions)) if (s.uid === u.id) delete sessions[k];
    index(); saveUsers(); saveSessions();
    return { ok: true };
  }

  // ── 비밀번호 재설정: 가입한 이메일로 30분짜리 1회용 링크 ──
  function forgot({ email, ip = '' }) {
    email = String(email || '').trim().toLowerCase();
    if (limited('fp:' + ip, 20, 3600e3) || limited('fe:' + email, 3, 3600e3)) return null; // 제한에 걸려도 같은 응답(존재 여부·제한 여부를 알려 주지 않는다)
    const u = users[byEmail.get(email)]; if (!u || u.banned) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    resets.set(sha(token), { uid: u.id, exp: now() + 30 * 60e3 });
    return { token, to: u.email, nickname: u.nickname };
  }
  async function reset({ token, password, ip = '' }) {
    password = String(password || '');
    if (limited('rs:' + ip, 20, 600e3)) return { error: TOO_MANY };
    if (password.length < 8) return { error: '비밀번호는 8자 이상이어야 해요' };
    if (password.length > 64) return { error: '비밀번호는 64자 이하로 해 주세요' };
    const k = sha(String(token || '')), r = resets.get(k);
    if (!r || r.exp < now() || !users[r.uid]) { resets.delete(k); return { error: '링크가 만료됐거나 이미 사용했어요. 다시 요청해 주세요' }; }
    const salt = crypto.randomBytes(16), hash = await hashPw(password, salt);
    resets.delete(k);
    Object.assign(users[r.uid], { salt: salt.toString('hex'), hash: hash.toString('hex') });
    for (const [sk, s] of Object.entries(sessions)) if (s.uid === r.uid) delete sessions[sk]; // 다른 기기의 로그인은 모두 풀린다
    saveUsers(); saveSessions();
    return { ok: true };
  }

  // ── 차단 / 신고 / 이용 제한 ──
  const isBlocked = (uid, other) => !!(users[uid] && users[uid].blocks && users[uid].blocks.includes(other));
  function block(uid, target) {
    const u = users[uid]; if (!u) return { error: '로그인이 필요해요' };
    if (!users[target] || target === uid) return { error: '차단할 수 없는 사람이에요' };
    u.blocks = u.blocks || []; if (!u.blocks.includes(target)) u.blocks.push(target);
    saveUsers(); return { ok: true, nickname: users[target].nickname };
  }
  function unblock(uid, target) { const u = users[uid]; if (!u) return { error: '로그인이 필요해요' }; u.blocks = (u.blocks || []).filter((x) => x !== target); saveUsers(); return { ok: true }; }
  const blocksOf = (uid) => ((users[uid] && users[uid].blocks) || []).filter((x) => users[x]).map((x) => ({ id: x, nickname: users[x].nickname }));
  const REASONS = ['욕설·괴롭힘', '불쾌한 닉네임·내용', '부정행위', '기타'];
  function report({ reporter, target, room, reason, context }) {
    if (!users[reporter] || !users[target] || reporter === target) return { error: '신고할 수 없는 사람이에요' };
    if (limited('rp:' + reporter, 10, 3600e3)) return { error: TOO_MANY };
    const all = read(F.reports, []);
    all.push({ at: now(), reporter, reporterName: users[reporter].nickname, target, targetName: users[target].nickname, targetUsername: users[target].username, room: String(room || '').slice(0, 8), reason: REASONS.includes(reason) ? reason : '기타', context: String(context || '').slice(0, 1000) });
    write(F.reports, all.slice(-2000));
    return { ok: true };
  }
  function setBan(username, on) { const u = users[byName.get(String(username || '').toLowerCase())]; if (!u) return { error: '그런 아이디가 없어요' }; u.banned = !!on; if (on) for (const [k, s] of Object.entries(sessions)) if (s.uid === u.id) delete sessions[k]; saveUsers(); saveSessions(); return { ok: true, id: u.id }; }
  const listReports = () => read(F.reports, []);
  const idOfUsername = (username) => byName.get(String(username || '').toLowerCase());

  // 게임 자리 열쇠 (계정마다 고정, 서버 비밀값 없이는 만들 수 없다)
  const playerToken = (uid) => crypto.createHmac('sha256', secret).update('player:' + uid).digest('hex');

  return { signup, login, verify, logout, deleteAccount, playerToken, limited, forgot, reset, isBlocked, block, unblock, blocksOf, report, setBan, idOfUsername, listReports, REASONS };
}

module.exports = { createAuth };
