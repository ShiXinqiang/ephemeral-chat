const socket = io();

let currentRoom = null;
let myId = null;
let isHost = false;
let aesKey = null; 
let messages = []; 
let roomUsers = {}; 
let expireTime = 60; 

// ================= UI 交互逻辑 =================
function togglePanel() {
    document.getElementById('control-panel').classList.toggle('open');
}

function openModal(targetId, currentAlias) {
    if (!isHost || targetId === myId) return; // 只有房主能操作别人
    document.getElementById('modal-target-id').value = targetId;
    document.getElementById('modal-title').innerText = currentAlias;
    document.getElementById('modal-desc').innerText = "请选择对该成员的操作";
    document.getElementById('action-modal').style.display = 'flex';
}
function closeModal() { document.getElementById('action-modal').style.display = 'none'; }

function updateTimer() {
    expireTime = parseInt(document.getElementById('timer-setting').value);
    alert('本地销毁时间已更新！');
}

// ================= 核心网络逻辑 =================
async function generateKey() { return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }

async function createRoom() {
    const maxUsers = document.getElementById('max-users').value;
    aesKey = await generateKey();
    socket.emit('create-room', { maxUsers });
}

socket.on('room-created', ({ roomId, password, myId: id }) => {
    currentRoom = roomId; myId = id; isHost = true;
    document.getElementById('info-id').innerText = roomId;
    document.getElementById('info-pwd').innerText = password;
    document.getElementById('host-controls').style.display = 'block';
    document.getElementById('guest-notice').style.display = 'none';
    enterChatroom();
});

socket.on('join-request', async ({ socketId, passcode }) => {
    const alias = prompt(`【入群申请】\n对方暗号: ${passcode}\n\n请为他设置一个强制备注 (如: 01号):`);
    if (alias) {
        const rawKey = await window.crypto.subtle.exportKey("raw", aesKey);
        socket.emit('approve-user', { roomId: currentRoom, targetSocketId: socketId, alias, sharedKey: rawKey });
    }
});

function requestJoin() {
    const roomId = document.getElementById('join-link').value;
    const password = document.getElementById('join-pwd').value;
    const passcode = document.getElementById('join-passcode').value;
    socket.emit('request-join', { roomId, password, passcode });
    alert('申请已发送，等待房主审批...');
}

socket.on('join-approved', async ({ roomId, alias, sharedKey, myId: id }) => {
    currentRoom = roomId; myId = id; isHost = false;
    aesKey = await window.crypto.subtle.importKey("raw", sharedKey, "AES-GCM", true, ["encrypt", "decrypt"]);
    enterChatroom();
});

// ================= 控制台功能 (房主专属) =================
function refreshPwd() {
    if(confirm('刷新后，旧密码将失效，确定刷新吗？')) socket.emit('refresh-password', currentRoom);
}
socket.on('password-updated', (newPwd) => {
    document.getElementById('info-pwd').innerText = newPwd;
});

function changeAlias() {
    const targetId = document.getElementById('modal-target-id').value;
    const newAlias = prompt("请输入新备注:");
    if (newAlias) {
        socket.emit('change-alias', { roomId: currentRoom, targetId, newAlias });
        closeModal();
    }
}

function kickUser() {
    const targetId = document.getElementById('modal-target-id').value;
    if(confirm('确定将此人永久移出对话吗？')) {
        socket.emit('kick-user', { roomId: currentRoom, targetId });
        closeModal();
    }
}

socket.on('kicked', () => { alert('您已被房主移出群组，数据已就地销毁。'); location.reload(); });
socket.on('room-destroyed', () => { alert('房主已解散群组，安全通道已关闭。'); location.reload(); });
socket.on('error', (msg) => alert(`系统提示: ${msg}`));

// 更新成员列表 UI
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
        // 提取名字首字母作为头像
        const avatarLetter = alias.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').charAt(0) || '?';
        li.innerHTML = `
            <div class="member-avatar">${avatarLetter}</div>
            <div style="flex:1;">
                <div style="font-weight:bold;">${alias} ${id === myId ? '(我)' : ''}</div>
            </div>
        `;
        // 房主点击别人可以操作
        if (isHost && id !== myId) {
            li.onclick = () => openModal(id, alias);
        }
        ul.appendChild(li);
    }
    renderCanvas(); // 名字更新后重新渲染画布防止错乱
});

// ================= 端到端加密与气泡渲染 =================
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

// 监听回车发送
document.getElementById('msg-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendMessage();
});

socket.on('receive-message', async ({ encryptedBlob, senderId }) => {
    try {
        const iv = new Uint8Array(encryptedBlob.iv);
        const data = new Uint8Array(encryptedBlob.data);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, data);
        const msgObj = JSON.parse(new TextDecoder().decode(decrypted));
        
        messages.push({ senderId, text: msgObj.text, time: msgObj.time });
        renderCanvas();
    } catch (e) { console.error("解密拦截"); }
});

// ================= Telegram 风格 Canvas 渲染引擎 =================
const canvas = document.getElementById('chat-canvas');
const ctx = canvas.getContext('2d');

function enterChatroom() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    resizeCanvas();
    // 销毁循环
    setInterval(() => {
        const now = Date.now();
        const originalLength = messages.length;
        messages = messages.filter(m => (now - m.time) < (expireTime * 1000));
        if (messages.length !== originalLength) renderCanvas();
    }, 1000);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - 120; // 减去头部和底部高度
    renderCanvas();
}
window.addEventListener('resize', resizeCanvas);

// 绘制圆角矩形 (聊天气泡)
function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius); ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
    if (fill) ctx.fill(); if (stroke) ctx.stroke();
}

function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制暗黑背景防截图水印
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.font = '20px sans-serif';
    const myAliasName = roomUsers[myId] || 'GUEST';
    for(let i=0; i<canvas.width; i+=120) {
        for(let j=0; j<canvas.height; j+=80) {
            ctx.fillText(myAliasName, i, j);
        }
    }

    let y = 30; // 初始Y坐标
    ctx.font = '15px sans-serif';
    
    messages.forEach(m => {
        const isMe = m.senderId === myId;
        const alias = roomUsers[m.senderId] || '未知';
        const text = m.text;
        
        // 测量文本宽度 (粗略换行逻辑)
        const maxWidth = canvas.width * 0.7; // 气泡最大宽度70%
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
        
        // 计算气泡X坐标 (如果是自己，靠右；如果是别人，靠左)
        const x = isMe ? canvas.width - bubbleWidth - 15 : 15;
        
        // 绘制气泡背景
        ctx.fillStyle = isMe ? '#2b5278' : '#1a1a1a'; // Telegram 蓝紫色 / 暗灰色
        roundRect(ctx, x, y, bubbleWidth, bubbleHeight, 12, true, false);
        
        // 绘制发送者名字 (小字)
        ctx.fillStyle = isMe ? '#8ab4f8' : '#bb86fc';
        ctx.font = '12px sans-serif';
        ctx.fillText(alias, x + 12, y + 20);
        
        // 绘制消息正文
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '15px sans-serif';
        let textY = y + 40;
        lines.forEach(line => {
            ctx.fillText(line, x + 12, textY);
            textY += 20;
        });
        
        y += bubbleHeight + 15; // 下一条消息的间距
    });
}

// 防查岗机制
let panicShield = document.getElementById('panic-shield');
window.addEventListener('blur', () => { panicShield.style.display = 'flex'; document.title = "Google"; });
window.addEventListener('focus', () => { panicShield.style.display = 'none'; document.title = "Secure TG"; });
