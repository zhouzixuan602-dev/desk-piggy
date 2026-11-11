// The speech bubble: plain DOM floating above the pig's head.

const CSS = `
.piggy-bubble{position:absolute;left:50%;bottom:0;z-index:5;box-sizing:border-box;max-width:82%;width:max-content;
  padding:7px 13px 8px;border-radius:17px;background:rgba(255,255,255,.97);color:#5b2638;
  font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;
  box-shadow:0 5px 16px rgba(120,40,70,.22),0 0 0 1.5px rgba(255,143,175,.6);
  opacity:0;transform:translate(-50%,6px) scale(.6);transform-origin:50% 100%;
  transition:opacity .16s ease,transform .24s cubic-bezier(.3,1.6,.5,1)}
.piggy-bubble::after{content:"";position:absolute;left:50%;bottom:-5px;width:11px;height:11px;margin-left:-5.5px;
  background:inherit;border-radius:0 0 3px 0;transform:rotate(45deg);
  box-shadow:1.5px 1.5px 0 0 rgba(255,143,175,.6)}
.piggy-bubble.on{opacity:1;transform:translate(-50%,0) scale(1)}
@media (prefers-reduced-motion:reduce){.piggy-bubble{transition:opacity .16s ease}}
`;

export function createBubble(container) {
  if (!document.getElementById('piggy-bubble-css')) {
    const style = document.createElement('style');
    style.id = 'piggy-bubble-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.className = 'piggy-bubble';
  el.setAttribute('role', 'status');
  container.appendChild(el);
  let timer = 0;
  let text = '';

  return {
    el,
    get text() {
      return el.classList.contains('on') ? text : '';
    },
    say(message, ms) {
      text = String(message ?? '').trim().slice(0, 80);
      if (!text) return this.hide();
      el.textContent = text;
      el.classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove('on'), ms ?? Math.max(1900, 1000 + text.length * 150));
    },
    hide() {
      clearTimeout(timer);
      el.classList.remove('on');
    },
    /** `bottom` is the distance from the container's bottom edge, in px. */
    place(bottom) {
      el.style.bottom = `${Math.round(bottom)}px`;
    },
  };
}
