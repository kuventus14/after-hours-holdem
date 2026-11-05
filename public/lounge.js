const guide = document.querySelector('#guideDialog');
document.querySelectorAll('[data-guide]').forEach(button => button.addEventListener('click', () => guide.showModal()));
guide.querySelector('.guide-close').addEventListener('click', () => guide.close());
guide.addEventListener('click', event => { if (event.target === guide) { const box = guide.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) guide.close(); } });

document.querySelector('#inviteBtn').addEventListener('click', async () => {
  const room = document.querySelector('#roomCode').textContent.trim();
  if (!room) return;
  const link = `${location.origin}/#${room}`;
  let copied = false;
  try { await navigator.clipboard.writeText(link); copied = true; } catch {
    const input = document.createElement('textarea');
    input.value = link;
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(input); input.select();
    try { copied = document.execCommand('copy'); } catch {}
    input.remove();
  }
  const toast = document.querySelector('#toast');
  toast.textContent = copied ? '초대 링크를 복사했어요. 친구에게 보내주세요.' : `친구에게 방 코드 ${room}를 알려주세요.`;
  toast.hidden = false;
  clearTimeout(window.__inviteToast);
  window.__inviteToast = setTimeout(() => { toast.hidden = true; }, 3000);
});

// The activity log remains available without taking over a small screen.
const compactScreen = matchMedia('(max-width: 700px)');
const activity = document.querySelector('.activity');
const fitActivity = () => { activity.open = !compactScreen.matches; };
compactScreen.addEventListener('change', fitActivity);
fitActivity();
