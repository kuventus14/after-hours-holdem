// 테스트용 봇: node bots.js <방코드> <봇수>
const WebSocket = require('ws');
const [room, n = 4] = process.argv.slice(2);
const names = ['철수','영희','민수','지아','도윤','서연','하준','수빈','예린'];
for (let i = 0; i < +n; i++) {
  const ws = new WebSocket('ws://localhost:3000');
  const token = 'bot-token-' + i + '-' + room;
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room, name: names[i], token })));
  // 시험용: /tmp/bot-emote.cmd 에 "이름 종류" (예: 민수 angry) 를 적으면 그 가상 플레이어가 감정표현을 보낸다
  setInterval(() => {
    try {
      const fs = require('fs'), line = fs.readFileSync('/tmp/bot-emote.cmd', 'utf8').trim();
      const [who, kind] = line.split(/\s+/);
      if (who === names[i] && kind) { fs.writeFileSync('/tmp/bot-emote.cmd', ''); ws.send(JSON.stringify({ t: 'emote', k: kind })); console.log(who, '감정표현', kind); }
    } catch {}
  }, 150);
  ws.on('message', (raw) => {
    const s = JSON.parse(raw);
    if (s.t !== 'state') return;
    const me = s.players[s.me];
    if (s.ended && !ws._logged) { ws._logged = true; const st = s.settlement; console.log(`[${me.name}] 종료됨 사유=${st.reason} 순위/손익=${st.rows.map(r => r.name + ':' + r.net).join(', ')} 송금=${st.transfers.map(t => t.fromName + '→' + t.toName + ' ' + t.amount).join(', ') || '없음'}`); }
    // 리바인 기회가 남았을 때만, 판마다 한 번만 요청한다 (거절당한 요청을 매번 되풀이하면 서버와 서로 폭주한다)
    if (me.chips === 0 && s.phase === 'showdown' && me.rebuysLeft > 0 && ws._rebuyHand !== s.handNo) { ws._rebuyHand = s.handNo; ws.send(JSON.stringify({ t: 'rebuy' })); }
    if (s.toAct !== s.me) return;
    setTimeout(() => {
      const r = Math.random(), toCall = s.currentBet - me.bet;
      let m;
      if (r < 0.12 && toCall > 0) m = { a: 'fold' };
      else if (r < 0.8) m = { a: toCall > 0 ? 'call' : 'check' };
      else m = { a: 'raise', amount: s.currentBet + s.minRaise * (1 + Math.floor(Math.random() * 3)) };
      ws.send(JSON.stringify({ t: 'act', ...m }));
    }, 800 + Math.random() * 1500);
  });
}
