const socket = io();

let currentRoom = null;
let myId = null;
let isHost = false;
let aesKey = null; 
let messages = []; 
let roomUsers = {}; 
let pendingRequests = []; // 申请列队
let expireTime = 60; 

// ================= 定制 UI 组件 (替代 alert/prompt) =================
function showToast(msg, type = 'info') {
    const toast = document.getElementById('sys-toast');
    toast.innerText = msg;
    toast.className = `show ${type}`;
    setTimeout(() => { toast.className = ''; }, 3000);
}
socket.on('sys-toast', ({msg, type}) => showToast(msg, type));

let uiModalCallback = null;
function showUiModal({ title, desc, inputPlaceholder, isDanger, confirmText }, callback) {
    document.getElementById('ui-modal-title').innerText = title;
    document.getElementById('ui-modal-desc').innerText = desc || '';
    
    const inputEl = document.getElementById('ui-modal-input');
    if (inputPlaceholder !== undefined) {
        inputEl.style.display = 'block';
        inputEl.placeholder = inputPlaceholder;
        inputEl.value = '';
    } else {
        inputEl.style.display = 'none';
    }

    const confirmBtn = document.getElementById('ui-modal-confirm-btn');
    confirmBtn.innerText = confirmText || '确定';
    confirmBtn.style.background = isDanger ? 'var(--danger)' : 'var(--accent)';
    
    document.getElementById('ui-modal').style.display = 'flex';
    uiModalCallback = callback;
}

function closeUiModal() {
    document.getElementById('ui-modal').style.display = 'none';
    uiModalCallback = null;
}

document.getElementById('ui-modal-confirm-btn').addEventListener('click', () => {
    if (uiModalCallback) {
        const val = document.getElementById('ui-modal-input').value;
        uiModalCallback(val);
    }
    closeUiModal();
});

function togglePanel() { document.getElementById('control-panel').classList.toggle('open'); }
function updateTimer() {
    expireTime = parseInt(document.getElementById('timer-setting').value);
    showToast('本地销毁时间已更新', 'success');
}

// ================= 核心网络与加密 =================
async function generateKey() { return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }

async function createRoom() {
    const maxUsers = document.getElementById('max-users').value;
    aesKey = await generateKey();
    socket.emit('create-room', { maxUsers });
}

function setupHostUI(roomId, password) {
    isHost = true;
    document.getElementById('info-id').innerText = roomId;
    if(password) document.getElementById('info-pwd').innerText = password;
    document.getElementById('host-controls').style.display = 'block';
    document.getElementById('guest-notice').style.display = 'none';
    renderPendingList(); // 恢复待处理列表UI
}

socket.on('room-created', ({ roomId, password, myId: id }) => {
    currentRoom = roomId; myId = id; 
    setupHostUI(roomId, password);
    showToast(`创建成功！房间ID: ${roomId}`, 'success');
    enterChatroom();
});

// === 【继承机制】如果是普通人变成了房主 ===
socket.on('you-are-new-host', (password) => {
    showToast('原房主已退出，您已自动继承房主权限！', 'success');
    setupHostUI(currentRoom, password);
});

function requestJoin() {
    const roomId = document.getElementById('join-link').value;
    const password = document.getElementById('join-pwd').value;
    const passcode = document.getElementById('join-passcode').value;
    if(!roomId || !password || !passcode) return showToast('请填写完整信息', 'error');
    socket.emit('request-join', { roomId, password, passcode });
}

socket.on('join-approved', async ({ roomId, alias, sharedKey, myId: id }) => {
    currentRoom = roomId; myId = id; isHost = false;
    aesKey = await window.crypto.subtle.importKey("raw", sharedKey, "AES-GCM", true, ["encrypt", "decrypt"]);
    enterChatroom();
});

// ================= 申请列表逻辑 (Waiting Room) =================
socket.on('join-request', ({ socketId, passcode }) => {
    // 放入待审批列队
    pendingRequests.push({ socketId, passcode });
    showToast('收到新的入群申请，请在控制台查看', 'info');
    renderPendingList();
});

function renderPendingList() {
    const badge = document.getElementById('req-badge');
    const pendingSection = document.getElementById('pending-section');
    const ul = document.getElementById('pending-ul');
    document.getElementById('pending-count').innerText = pendingRequests.length;
    
    if (pendingRequests.length > 0 && isHost) {
        badge.style.display = 'block';
        badge.innerText = pendingRequests.length;
        pendingSection.style.display = 'block';
    } else {
        badge.style.display = 'none';
        pendingSection.style.display = 'none';
    }

    ul.innerHTML = '';
    pendingRequests.forEach((req, index) => {
        const li = document.createElement('li');
        li.className = 'member-item';
        li.innerHTML = `
            <div style="flex:1;">
                <div style="font-size: 14px; font-weight:bold;">暗号: ${req.passcode}</div>
            </div>
            <button class="btn-small btn-accept" onclick="approveReq(${index})">同意</button>
            <button class="btn-small btn-reject" onclick="rejectReq(${index})">拒绝</button>
        `;
        ul.appendChild(li);
    });
}

async function approveReq(index) {
    const req = pendingRequests[index];
    showUiModal({
        title: '通过申请',
        desc: `对方暗号：${req.passcode}\n请为其强制设定一个备注：`,
        inputPlaceholder: '例如：01号/猎鹰',
        confirmText: '生成通道并放行'
    }, async (alias) => {
        if (!alias) return showToast('必须填写备注', 'error');
        // 将自己本地的 E2EE 主密钥导出并发给新人 (支持继承的关键)
        const rawKey = await window.crypto.subtle.exportKey("raw", aesKey);
        socket.emit('approve-user', { roomId: currentRoom, targetSocketId: req.socketId, alias, sharedKey: rawKey });
        pendingRequests.splice(index, 1);
        renderPendingList();
    });
}

function rejectReq(index) {
    socket.emit('reject-user', pendingRequests[index].socketId);
    pendingRequests.splice(index, 1);
    renderPendingList();
}

// ================= 房主高级控制 =================
function refreshPwd() {
    showUiModal({
        title: '刷新密码', desc: '旧密码将立刻失效，确认刷新？', confirmText: '确定刷新'
    }, () => { socket.emit('refresh-password', currentRoom); });
}
socket.on('password-updated', (newPwd) => {
    document.getElementById('info-pwd').innerText = newPwd;
    showToast('密码已重置', 'success');
});

// 操作现有成员
function handleMemberClick(id, alias) {
    if (!isHost || id === myId) return;
    showUiModal({
        title: `操作成员: ${alias}`, desc: '请选择要执行的操作', confirmText: '✏️ 修改备注', isDanger: false
    }, () => {
        showUiModal({ title: '修改备注', inputPlaceholder: '输入新备注' }, (newAlias) => {
            if(newAlias) socket.emit('change-alias', { roomId: currentRoom, targetId: id, newAlias });
        });
    });

    // 为模态框临时注入一个“踢出”按钮
    const actionsDiv = document.querySelector('.ui-modal-actions');
    const kickBtn = document.createElement('button');
    kickBtn.innerText = '🚫 踢出群组';
    kickBtn.style.background = 'var(--danger)';
    kickBtn.id = 'temp-kick-btn';
    kickBtn.onclick = () => {
        socket.emit('kick-user', { roomId: currentRoom, targetId: id });
        closeUiModal();
    };
    if(!document.getElementById('temp-kick-btn')) actionsDiv.appendChild(kickBtn);
    
    // 弹窗关闭时移除临时按钮
    const originalClose = uiModalCallback;
    uiModalCallback = (val) => {
        const btn = document.getElementById('temp-kick-btn');
        if(btn) btn.remove();
        if(originalClose) originalClose(val);
    };
}

socket.on('kicked', () => { 
    showToast('您已被移出群组', 'error'); 
    setTimeout(() => location.reload(), 2000); 
});

// 更新成员列表
socket.on('update-users', (usersMap) => {
    roomUsers = usersMap;
    const count = Object.keys(usersMap).length;
    document.getElementById('member-count').innerText = `${count} 人在线`;
    document.getElementById('panel-member-count').innerText = count;
    
    const ul = document.getElementById('member-ul');
    ul.innerHTML = '';
    for (const [id, alias] of Object.entries(usersMap)) {
        const li = document.createElement('li');
        li.className = 'member-item';
        const avatarLetter = alias.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').charAt(0) || '?';
        li.innerHTML = `
            <div class="member-avatar">${avatarLetter}</div>
            <div style="flex:1; font-weight:bold; color: ${id===myId ? 'var(--accent)' : 'inherit'}">
                ${alias}
            </div>
        `;
        if (isHost && id !== myId) li.onclick = () => handleMemberClick(id, alias);
        ul.appendChild(li);
    }
    renderCanvas(); 
});

// ================= 加密发信与 Canvas 渲染引擎 =================
async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value;
    if (!text) return;
    
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify({ text: text, time: Date.now() }));
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, encoded);
    
    socket.emit('encrypted-message', {
        roomId: currentRoom, senderId: myId,
        encryptedBlob: { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) }
    });
    input.value = '';
}

document.getElementById('msg-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

socket.on('receive-message', async ({ encryptedBlob, senderId }) => {
    try {
        const iv = new Uint8Array(encryptedBlob.iv);
        const data = new Uint8Array(encryptedBlob.data);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, data);
        const msgObj = JSON.parse(new TextDecoder().decode(decrypted));
        
        messages.push({ senderId, text: msgObj.text, time: msgObj.time });
        renderCanvas();
    } catch (e) { console.error("解密失败"); }
});

const canvas = document.getElementById('chat-canvas');
const ctx = canvas.getContext('2d');

function enterChatroom() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    resizeCanvas();
    setInterval(() => {
        const now = Date.now();
        const originalLength = messages.length;
        messages = messages.filter(m => (now - m.time) < (expireTime * 1000));
        if (messages.length !== originalLength) renderCanvas();
    }, 1000);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 120;
    renderCanvas();
}
window.addEventListener('resize', resizeCanvas);

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius); ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath(); ctx.fill();
}

function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.font = '20px sans-serif';
    const myAliasName = roomUsers[myId] || 'GUEST';
    for(let i=0; i<canvas.width; i+=120) for(let j=0; j<canvas.height; j+=80) ctx.fillText(myAliasName, i, j);

    let y = 30; 
    ctx.font = '15px sans-serif';
    
    messages.forEach(m => {
        const isMe = m.senderId === myId;
        const alias = roomUsers[m.senderId] || '未知 (已离线)';
        const text = m.text;
        
        const maxWidth = canvas.width * 0.7;
        let lines = [];
        let currentLine = '';
        for(let i=0; i<text.length; i++) {
            let testLine = currentLine + text[i];
            if(ctx.measureText(testLine).width > maxWidth && i > 0) {
                lines.push(currentLine); currentLine = text[i];
            } else { currentLine = testLine; }
        }
        lines.push(currentLine);
        
        const bubbleWidth = Math.max(ctx.measureText(alias).width, ctx.measureText(lines[0]).width) + 30;
        const bubbleHeight = lines.length * 20 + 30;
        
        const x = isMe ? canvas.width - bubbleWidth - 15 : 15;
        
        ctx.fillStyle = isMe ? '#2b5278' : '#1a1a1a';
        roundRect(ctx, x, y, bubbleWidth, bubbleHeight, 12);
        
        ctx.fillStyle = isMe ? '#8ab4f8' : '#bb86fc';
        ctx.font = '12px sans-serif';
        ctx.fillText(alias, x + 12, y + 20);
        
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '15px sans-serif';
        let textY = y + 40;
        lines.forEach(line => { ctx.fillText(line, x + 12, textY); textY += 20; });
        
        y += bubbleHeight + 15;
    });
}

// 失去焦点防查岗
let panicShield = document.getElementById('panic-shield');
window.addEventListener('blur', () => { panicShield.style.display = 'flex'; document.title = "Google"; });
window.addEventListener('focus', () => { panicShield.style.display = 'none'; document.title = "Secure TG"; });
