'use strict';
// 메일 보내기(비밀번호 재설정 링크). 메일 서비스 키가 없으면 보내지 않고 서버 로그에만 남긴다(개발·시험용).
//  - RESEND_API_KEY + HOLDEM_MAIL_FROM 이 있으면 Resend(https://resend.com) 로 보낸다.
//  - HOLDEM_MAIL_DIR 이 있으면 메일 내용을 그 폴더에 파일로 쓴다(시험용).
const fs = require('fs');
const path = require('path');

async function sendMail({ to, subject, text }) {
  if (process.env.HOLDEM_MAIL_DIR) {
    fs.mkdirSync(process.env.HOLDEM_MAIL_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.HOLDEM_MAIL_DIR, `${Date.now()}-${to.replace(/[^a-z0-9@.]/gi, '_')}.txt`), `to: ${to}\nsubject: ${subject}\n\n${text}\n`);
    return true;
  }
  if (process.env.RESEND_API_KEY && process.env.HOLDEM_MAIL_FROM) {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.HOLDEM_MAIL_FROM, to, subject, text }) });
      if (!r.ok) console.error('메일 전송 실패', r.status);
      return r.ok;
    } catch (e) { console.error('메일 전송 오류', e.message); return false; }
  }
  console.warn(`[메일 서비스 없음] ${to} 에게 보낼 메일을 서버 로그에만 남깁니다:\n${subject}\n${text}\n`);
  return false;
}

module.exports = { sendMail };
