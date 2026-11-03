// Petits composants UI : toast, modale, icônes
export const icons = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M11 16V7.83l-3.59 3.58L6 10l6-6 6 6-1.41 1.41L13 7.83V16h-2Zm-6 4v-2h14v2H5Z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14Zm8-14v14h4V5h-4Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>',
  rew: '<svg viewBox="0 0 24 24"><path d="M12.5 3a9 9 0 0 0-9 9H1l3.5 4 3.5-4H5.5a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 12.5 3Z"/><text x="12.5" y="15" font-size="7" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M11.5 3a9 9 0 0 1 9 9H23l-3.5 4-3.5-4h2.5a7 7 0 1 0-2.05 4.95l1.42 1.42A9 9 0 1 1 11.5 3Z"/><text x="11.5" y="15" font-size="7" text-anchor="middle" font-family="sans-serif" font-weight="700">10</text></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2Zm7 12 .95 2.55L22.5 17.5l-2.55.95L19 21l-.95-2.55L15.5 17.5l2.55-.95L19 14Z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5ZM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>',
};

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 2600);
}

/**
 * Modale générique. buttons: [{label, value, kind}] ; content: HTML ; onMount(el, close)
 */
export function modal({ title, content = '', buttons = [{ label: 'OK', value: true, kind: 'primary' }], onMount, sheet = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = `modal-wrap ${sheet ? 'sheet' : ''}`;
    wrap.innerHTML = `
      <div class="modal" role="dialog">
        ${title ? `<h3>${title}</h3>` : ''}
        <div class="modal-body">${content}</div>
        ${buttons.length ? `<div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.kind || 'ghost'}" data-i="${i}">${b.label}</button>`).join('')}</div>` : ''}
      </div>`;
    const close = (v) => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 200);
      resolve(v);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close(null);
      const b = e.target.closest('[data-i]');
      if (b && b.parentElement.classList.contains('modal-actions')) {
        const btn = buttons[+b.dataset.i];
        close(typeof btn.value === 'function' ? btn.value(wrap) : btn.value);
      }
    });
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    onMount?.(wrap, close);
    const firstInput = wrap.querySelector('input,textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 250);
  });
}

export async function promptText(title, value = '', placeholder = '') {
  return modal({
    title,
    content: `<input class="input" id="m-input" value="${String(value).replace(/"/g, '&quot;')}" placeholder="${placeholder}">`,
    buttons: [
      { label: 'Annuler', value: null },
      { label: 'Valider', value: (w) => w.querySelector('#m-input').value.trim(), kind: 'primary' },
    ],
    onMount: (w, close) => w.querySelector('#m-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(e.target.value.trim());
    }),
  });
}

export async function confirmDlg(title, text, okLabel = 'Confirmer', danger = false) {
  return modal({
    title,
    content: `<p>${text}</p>`,
    buttons: [
      { label: 'Annuler', value: false },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
}

export function actionSheet(title, actions) {
  return modal({
    title,
    content: `<div class="sheet-list">${actions.map((a, i) => `<button class="sheet-item ${a.danger ? 'danger' : ''}" data-a="${i}">${a.icon || ''}<span>${a.label}</span></button>`).join('')}</div>`,
    buttons: [{ label: 'Fermer', value: null }],
    onMount: (w, close) => w.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => close(actions[+b.dataset.a].value))),
  });
}
