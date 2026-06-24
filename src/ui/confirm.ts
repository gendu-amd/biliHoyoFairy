// 样式化确认弹窗：替代原生 confirm()，与面板同风格。支持键盘（Esc 取消 / Enter 确认）、点击遮罩取消、
// 危险操作默认聚焦「取消」降低误确认。返回 Promise<boolean>。挂在 document.body（与 toast/panel 同级，样式由 GM_addStyle 提供）。
interface ConfirmOpts {
  title?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

let current: HTMLElement | null = null;

export function confirmModal(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // 同一时刻只保留一个弹窗：若已有，先把旧的当作「取消」关掉
    if (current) {
      current.remove();
      current = null;
    }
    const back = document.createElement('div');
    back.className = 'bfb-modal-back';
    const box = document.createElement('div');
    box.className = 'bfb-modal' + (opts.danger ? ' danger' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'bfb-modal-title';
    title.textContent = opts.title || '确认操作';

    const msg = document.createElement('div');
    msg.className = 'bfb-modal-msg';
    msg.textContent = message; // textContent：防注入；换行靠 CSS white-space:pre-line 呈现

    const btns = document.createElement('div');
    btns.className = 'bfb-modal-btns';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'bfb-modal-btn ghost';
    cancel.textContent = opts.cancelText || '取消';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'bfb-modal-btn' + (opts.danger ? ' danger' : '');
    ok.textContent = opts.okText || '确定';
    btns.append(cancel, ok);

    box.append(title, msg, btns);
    back.appendChild(box);
    (document.body || document.documentElement).appendChild(back);
    current = back;

    let done = false;
    const close = (val: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (current === back) current = null;
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    cancel.onclick = () => close(false);
    ok.onclick = () => close(true);
    back.onclick = (e) => {
      if (e.target === back) close(false); // 点遮罩（非弹窗本体）= 取消
    };
    document.addEventListener('keydown', onKey, true);
    // 危险操作默认聚焦「取消」，普通操作聚焦「确定」（配合 Enter 快捷确认）
    (opts.danger ? cancel : ok).focus();
  });
}
