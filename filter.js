'use strict';
// 기본 욕설 가리기(채팅·한마디·닉네임). 글자 사이에 공백·기호를 끼워 넣어도 잡는다("시 발", "f.u.c.k").
// shortcut: 단어 목록 방식이라 변형·신조어를 다 막지는 못한다. 신고·차단이 본 방어이고, 이건 가장 흔한 것만 가린다 — 목록은 운영하면서 늘린다.
const WORDS = [
  '씨발', '시발', '씨팔', '시팔', '씹새', '씹할', '병신', '지랄', '개새끼', '개세끼', '좆', '느금마', '니애미', '니엄마', '애미뒤', '창녀', '걸레년', '썅', '썅년', '미친년', '미친놈', 'ㅅㅂ', 'ㅆㅂ', 'ㅂㅅ', 'ㅈㄹ',
  'fuck', 'fucker', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dickhead', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut',
];
const SEP = '[\\s._\\-*~`\'"^]*';
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE = new RegExp(WORDS.map((w) => [...w].map(esc).join(SEP)).join('|'), 'giu');

const clean = (text) => String(text).replace(RE, '***');
const hasBad = (text) => { RE.lastIndex = 0; return RE.test(String(text)); };

module.exports = { clean, hasBad };
