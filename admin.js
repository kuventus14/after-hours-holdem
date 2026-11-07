'use strict';
// 운영자 도구 (서버가 켜져 있는 채로 쓴다):  HOLDEM_ADMIN_TOKEN=... [HOLDEM_URL=http://localhost:3210] node admin.js reports | ban <아이디> | unban <아이디>
const base = process.env.HOLDEM_URL || 'http://localhost:3210', token = process.env.HOLDEM_ADMIN_TOKEN || '';
const [cmd, who] = process.argv.slice(2);
const call = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-admin-token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
(async () => {
  if (cmd === 'reports') {
    const { reports, error } = await call('/api/admin/reports'); if (error) return console.log('실패:', error);
    const n = {}; reports.forEach((r) => (n[r.targetUsername] = (n[r.targetUsername] || 0) + 1));
    console.log(`최근 신고 ${reports.length}건 (많이 신고된 순: ${Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}건`).join(', ') || '-'})\n`);
    reports.forEach((r) => console.log(`${new Date(r.at).toLocaleString()} · ${r.reporterName} → ${r.targetName} (@${r.targetUsername}) · ${r.reason} · 방 ${r.room}\n${r.context ? '  최근 채팅:\n' + r.context.split('\n').map((l) => '   ' + l).join('\n') + '\n' : ''}`));
  } else if ((cmd === 'ban' || cmd === 'unban') && who) console.log(JSON.stringify(await call('/api/admin/ban', { username: who, on: cmd === 'ban' })));
  else console.log('사용: node admin.js reports | ban <아이디> | unban <아이디>');
})().catch((e) => console.log('서버에 연결할 수 없어요:', e.message));
