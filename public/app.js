const socket = io();

let currentRoom = null; let currentPassword = null; let myId = null; let isHost = false;
let aesKey = null; let messages = []; let roomUsers = {}; let pendingRequests = []; let expireTime = 60; 

// ================= URL 邀请链接解析 =================
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('inv');
    if (inviteCode) {
        try {
            const decoded = atob(inviteCode); const [roomId, pwd] = decoded.split(':');
            if (roomId && pwd) {
                document.getElementById('create-card').style.display = 'none';
                document.getElementById('join-title').innerText = '🎟️ 您收到一份加密对话邀请';
                document.getElementById('join-link').value = roomId; document.getElementById('join-pwd').value = pwd;
                document.getElementById('join-link').style.display = 'none'; document.getElementById('join-pwd').style.display = 'none';
                document.getElementById('cancel-invite-btn').style.display = 'block';
                document.getElementById('join-btn').innerText = '一键发送申请';
                showToast('已自动载入邀请凭证，请输入暗号', 'success');
            }
        } catch (e) { showToast('邀请链接已损坏', 'error'); clearInvite(); }
    }
};

function clearInvite() {
    window.history.replaceState({}, document.title, window.location.pathname);
    document.getElementById('create-card').style.display = 'block'; document.getElementById('join-title').innerText = '加入现有对话';
    document.getElementById('join-link').style.display = 'block'; document.getElementById('join-pwd').style.display = 'block';
    document.getElementById('join-link').value = ''; document.getElementById('join-pwd').value = '';
    document.getElementById('cancel-invite-btn').style.display = 'none'; document.getElementById('join-btn').innerText = '发送申请';
}

// ================= 定制 UI 组件 =================
function showToast(msg, type = 'info') {
    const toast = document.getElementById('sys-toast'); toast.innerText = msg; toast.className = `show ${type}`;
    setTimeout(() => { toast.className = ''; }, 3000);
}
socket.on('sys-toast', ({msg, type}) => showToast(msg, type));

let uiModalCallback = null;
function showUiModal({ title, desc, inputPlaceholder, isDanger, confirmText }, callback) {
    document.getElementById('ui-modal-title').innerText = title; document.getElementById('ui-modal-desc').innerText = desc || '';
    const inputEl = document.getElementById('ui-modal-input');
    if (inputPlaceholder !== undefined) { inputEl.style.display = 'block'; inputEl.placeholder = inputPlaceholder; inputEl.value = ''; } else { inputEl.style.display = 'none'; }
    const confirmBtn = document.getElementById('ui-modal-confirm-btn'); confirmBtn.innerText = confirmText || '确定'; confirmBtn.style.background = isDanger ? 'var(--danger)' : 'var(--accent)';
    document.getElementById('ui-modal').style.display = 'flex'; uiModalCallback = callback;
}
function closeUiModal() { document.getElementById('ui-modal').style.display = 'none'; uiModalCallback = null; }
document.getElementById('ui-modal-confirm-btn').addEventListener('click', () => { if (uiModalCallback) uiModalCallback(document.getElementById('ui-modal-input').value); closeUiModal(); });

function togglePanel() { document.getElementById('control-panel').classList.toggle('open'); }
function updateTimer() { expireTime = parseInt(document.getElementById('timer-setting').value); showToast('销毁时间已更新', 'success'); }

// ================= 核心网络与加密 =================
async function generateKey() { return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }
async function createRoom() {
    const maxUsers = document.getElementById('max-users').value; aesKey = await generateKey(); socket.emit('create-room', { maxUsers });
}

function setupHostUI(roomId, password) {
    isHost = true; document.getElementById('info-id').innerText = roomId;
    if(password) { currentPassword = password; document.getElementById('info-pwd').innerText = password; }
    document.getElementById('host-controls').style.display = 'block'; document.getElementById('guest-notice').style.display = 'none'; renderPendingList();
}

socket.on('room-created', ({ roomId, password, myId: id }) => { currentRoom = roomId; myId = id; setupHostUI(roomId, password); showToast(`创建成功！房间ID: ${roomId}`, 'success'); enterChatroom(); });
socket.on('you-are-new-host', (password) => { showToast('已自动继承权限！', 'success'); setupHostUI(currentRoom, password); });

// --- 【前端防止狂点机制】冷却按钮 ---
function requestJoin() {
    const roomId = document.getElementById('join-link').value;
    const password = document.getElementById('join-pwd').value;
    const passcode = document.getElementById('join-passcode').value;
    if(!roomId || !password || !passcode) return showToast('请填写完整信息', 'error');
    
    const btn = document.getElementById('join-btn');
    btn.disabled = true;
    let countdown = 15;
    
    // 发送请求
    socket.emit('request-join', { roomId, password, passcode });
    
    // 按钮倒计时
    const interval = setInterval(() => {
        countdown--;
        btn.innerText = `等待冷却 (${countdown}s)`;
        btn.style.background = '#555';
        if(countdown <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.innerText = document.getElementById('cancel-invite-btn').style.display === 'block' ? '一键发送申请' : '发送申请';
            btn.style.background = 'var(--accent)';
        }
    }, 1000);
}

socket.on('join-approved', async ({ roomId, alias, sharedKey, myId: id }) => {
    currentRoom = roomId; myId = id; isHost = false;
    aesKey = await window.crypto.subtle.importKey("raw", sharedKey, "AES-GCM", true, ["encrypt", "decrypt"]);
    enterChatroom();
});

// ================= 高级控制 & 邀请链接 =================
function toggleInviteLink() {
    const isChecked = document.getElementById('invite-toggle').checked;
    document.getElementById('copy-invite-btn').style.display = isChecked ? 'block' : 'none';
    document.getElementById('invite-warn').style.display = isChecked ? 'block' : 'none';
}
function copyInviteLink() {
    if(!currentRoom || !currentPassword) return showToast('获取失败', 'error');
    const inviteCode = btoa(`${currentRoom}:${currentPassword}`);
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?inv=${inviteCode}`).then(() => showToast('免密邀请链接已复制', 'success'));
}
function refreshPwd() { showUiModal({ title: '刷新密码', desc: '旧密码及链接将失效，确认刷新？', confirmText: '确定' }, () => socket.emit('refresh-password', currentRoom)); }
socket.on('password-updated', (newPwd) => { currentPassword = newPwd; document.getElementById('info-pwd').innerText = newPwd; showToast('密码已重置', 'success'); });

// ================= 【升级版】申请列表逻辑与拉黑功能 =================
socket.on('join-request', ({ socketId, passcode }) => {
    // 确保本地不会出现两个一样的 socketId (兜底逻辑)
    if (!pendingRequests.find(req => req.socketId === socketId)) {
        pendingRequests.push({ socketId, passcode }); 
        showToast('收到新申请，请在控制台查看', 'info'); 
        renderPendingList();
    }
});

function renderPendingList() {
    const badge = document.getElementById('req-badge'); const pendingSection = document.getElementById('pending-section'); const ul = document.getElementById('pending-ul');
    document.getElementById('pending-count').innerText = pendingRequests.length;
    if (pendingRequests.length > 0 && isHost) { badge.style.display = 'block'; badge.innerText = pendingRequests.length; pendingSection.style.display = 'block'; } else { badge.style.display = 'none'; pendingSection.style.display = 'none'; }
    ul.innerHTML = '';
    pendingRequests.forEach((req) => {
        const li = document.createElement('li'); li.className = 'member-item';
        // 渲染 同意 / 拒绝 / 拉黑 三个按钮
        li.innerHTML = `
            <div style="flex:1; font-size:14px; font-weight:bold; overflow:hidden; text-overflow:ellipsis;">${req.passcode}</div>
            <button class="btn-small btn-accept" onclick="approveReq('${req.socketId}')">同意</button>
            <button class="btn-small btn-reject" onclick="rejectReq('${req.socketId}', false)">拒绝</button>
            <button class="btn-small" style="background:#555;" title="永久拉黑此人" onclick="rejectReq('${req.socketId}', true)">🚫</button>
        `;
        ul.appendChild(li);
    });
}

function approveReq(socketId) {
    const req = pendingRequests.find(r => r.socketId === socketId);
    if (!req) return;
    showUiModal({ title: '通过申请', desc: `暗号：${req.passcode}\n请设定备注：`, inputPlaceholder: '如：01号', confirmText: '放行' }, async (alias) => {
        if (!alias) return showToast('必须填写备注', 'error');
        const rawKey = await window.crypto.subtle.exportKey("raw", aesKey);
        socket.emit('approve-user', { roomId: currentRoom, targetSocketId: req.socketId, alias, sharedKey: rawKey });
        pendingRequests = pendingRequests.filter(r => r.socketId !== socketId); 
        renderPendingList();
    });
}

// 拒绝或拉黑 (block = true)
function rejectReq(socketId, block) { 
    if (block && !confirm('确认拉黑该设备？拉黑后他将永远无法加入本房间。')) return;
    socket.emit('reject-user', { roomId: currentRoom, targetSocketId: socketId, block: block }); 
    pendingRequests = pendingRequests.filter(r => r.socketId !== socketId); 
    renderPendingList(); 
}

// ================= 群组操作 =================
function handleMemberClick(id, alias) {
    if (!isHost || id === myId) return;
    showUiModal({ title: `操作: ${alias}`, desc: '请选择操作', confirmText: '✏️ 修改备注', isDanger: false }, () => {
        showUiModal({ title: '修改备注', inputPlaceholder: '新备注' }, (newAlias) => { if(newAlias) socket.emit('change-alias', { roomId: currentRoom, targetId: id, newAlias }); });
    });
    const actionsDiv = document.querySelector('.ui-modal-actions');
    const kickBtn = document.createElement('button'); kickBtn.innerText = '🚫 踢出群组'; kickBtn.style.background = 'var(--danger)'; kickBtn.id = 'temp-kick-btn';
    kickBtn.onclick = () => { socket.emit('kick-user', { roomId: currentRoom, targetId: id }); closeUiModal(); };
    if(!document.getElementById('temp-kick-btn')) actionsDiv.appendChild(kickBtn);
    const originalClose = uiModalCallback;
    uiModalCallback = (val) => { const btn = document.getElementById('temp-kick-btn'); if(btn) btn.remove(); if(originalClose) originalClose(val); };
}
socket.on('kicked', () => { showToast('您已被移出群组', 'error'); setTimeout(() => location.reload(), 2000); });
socket.on('update-users', (usersMap) => {
    roomUsers = usersMap; const count = Object.keys(usersMap).length; document.getElementById('member-count').innerText = `${count} 人在线`; document.getElementById('panel-member-count').innerText = count;
    const ul = document.getElementById('member-ul'); ul.innerHTML = '';
    for (const [id, alias] of Object.entries(usersMap)) {
        const li = document.createElement('li'); li.className = 'member-item'; const avatarLetter = alias.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').charAt(0) || '?';
        li.innerHTML = `<div class="member-avatar">${avatarLetter}</div><div style="flex:1; font-weight:bold; color: ${id===myId ? 'var(--accent)' : 'inherit'}">${alias}</div>`;
        if (isHost && id !== myId) li.onclick = () => handleMemberClick(id, alias); ul.appendChild(li);
    }
    updateWatermarkCache(); queueRender();
});

// ================= 发信与硬件渲染 =================
async function sendMessage() {
    const input = document.getElementById('msg-input'); const text = input.value; if (!text) return;
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); const encoded = new TextEncoder().encode(JSON.stringify({ text: text, time: Date.now() }));
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, encoded);
    socket.emit('encrypted-message', { roomId: currentRoom, senderId: myId, encryptedBlob: { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) } });
    input.value = '';
}
document.getElementById('msg-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
socket.on('receive-message', async ({ encryptedBlob, senderId }) => {
    try {
        const iv = new Uint8Array(encryptedBlob.iv); const data = new Uint8Array(encryptedBlob.data);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, data);
        const msgObj = JSON.parse(new TextDecoder().decode(decrypted));
        const m = { senderId, text: msgObj.text, time: msgObj.time }; calculateMessageLayout(m); messages.push(m);
        scrollToBottom(); queueRender();
    } catch (e) { console.error("解密失败"); }
});

const canvas = document.getElementById('chat-canvas'); const ctx = canvas.getContext('2d');
let scrollY = 0; let maxScrollY = 0; const bgCanvas = document.createElement('canvas');

function updateWatermarkCache() {
    bgCanvas.width = canvas.width; bgCanvas.height = canvas.height; const bctx = bgCanvas.getContext('2d');
    bctx.fillStyle = 'rgba(255, 255, 255, 0.02)'; bctx.font = '20px sans-serif'; const alias = roomUsers[myId] || 'GUEST';
    for(let i=0; i<bgCanvas.width; i+=120) for(let j=0; j<bgCanvas.height; j+=80) bctx.fillText(alias, i, j);
}

function enterChatroom() {
    document.getElementById('lobby').style.display = 'none'; document.getElementById('app').style.display = 'block'; resizeCanvas();
    setInterval(() => {
        const now = Date.now(); const originalLength = messages.length;
        messages = messages.filter(m => (now - m.time) < (expireTime * 1000));
        if (messages.length !== originalLength) { updateScrollBounds(); queueRender(); }
    }, 1000);
}

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight - 120; updateWatermarkCache(); messages.forEach(calculateMessageLayout); updateScrollBounds(); queueRender(); }
window.addEventListener('resize', resizeCanvas);
function calculateMessageLayout(m) {
    m.alias = roomUsers[m.senderId] || '未知'; ctx.font = '15px sans-serif'; const maxWidth = canvas.width * 0.7; let lines = []; let currentLine = '';
    for(let i=0; i<m.text.length; i++) { let testLine = currentLine + m.text[i]; if(ctx.measureText(testLine).width > maxWidth && i > 0) { lines.push(currentLine); currentLine = m.text[i]; } else { currentLine = testLine; } }
    lines.push(currentLine); ctx.font = '12px sans-serif'; const nameWidth = ctx.measureText(m.alias).width; ctx.font = '15px sans-serif'; const textWidth = ctx.measureText(lines[0]).width;
    m.lines = lines; m.bubbleWidth = Math.max(nameWidth, textWidth) + 30; m.bubbleHeight = lines.length * 20 + 30;
}
function updateScrollBounds() { let totalHeight = messages.reduce((sum, m) => sum + m.bubbleHeight + 15, 0); maxScrollY = Math.max(0, totalHeight - canvas.height + 40); if (scrollY > maxScrollY) scrollY = maxScrollY; }
function scrollToBottom() { updateScrollBounds(); scrollY = maxScrollY; }
canvas.addEventListener('wheel', (e) => { scrollY += e.deltaY; clampScroll(); queueRender(); });
let touchStartY = 0; canvas.addEventListener('touchstart', (e) => touchStartY = e.touches[0].clientY);
canvas.addEventListener('touchmove', (e) => { let deltaY = touchStartY - e.touches[0].clientY; scrollY += deltaY; touchStartY = e.touches[0].clientY; clampScroll(); queueRender(); });
function clampScroll() { if(scrollY < 0) scrollY = 0; if(scrollY > maxScrollY) scrollY = maxScrollY; }
function roundRect(ctx, x, y, width, height, radius) { ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius); ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath(); ctx.fill(); }

let isRendering = false; function queueRender() { if (!isRendering) { isRendering = true; requestAnimationFrame(() => { renderCanvas(); isRendering = false; }); } }
function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bgCanvas, 0, 0); let currentY = 20 - scrollY; 
    messages.forEach(m => {
        if (currentY + m.bubbleHeight < 0 || currentY > canvas.height) { currentY += m.bubbleHeight + 15; return; }
        const isMe = m.senderId === myId; const x = isMe ? canvas.width - m.bubbleWidth - 15 : 15;
        ctx.fillStyle = isMe ? '#2b5278' : '#1a1a1a'; roundRect(ctx, x, currentY, m.bubbleWidth, m.bubbleHeight, 12);
        ctx.fillStyle = isMe ? '#8ab4f8' : '#bb86fc'; ctx.font = '12px sans-serif'; ctx.fillText(m.alias, x + 12, currentY + 20);
        ctx.fillStyle = '#e0e0e0'; ctx.font = '15px sans-serif'; let textY = currentY + 40;
        m.lines.forEach(line => { ctx.fillText(line, x + 12, textY); textY += 20; }); currentY += m.bubbleHeight + 15;
    });
}
let panicShield = document.getElementById('panic-shield'); window.addEventListener('blur', () => { panicShield.style.display = 'flex'; document.title = "Google"; }); window.addEventListener('focus', () => { panicShield.style.display = 'none'; document.title = "Secure TG"; });
