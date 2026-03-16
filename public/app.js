const socket = io();

let currentRoom = null;
let myAlias = 'HOST';
let aesKey = null; // 端到端加密密钥
let messages = []; // 内存消息列队
let expireTime = 60; // 默认60秒

// UI 切换逻辑
function showCreate() { document.getElementById('create-panel').style.display = 'block'; document.getElementById('join-panel').style.display = 'none'; }
function showJoin() { document.getElementById('join-panel').style.display = 'block'; document.getElementById('create-panel').style.display = 'none'; }

// 生成 AES-GCM 密钥 (Web Crypto API)
async function generateKey() {
    return await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

// ================= 1. 房主逻辑 =================
async function createRoom() {
    const maxUsers = document.getElementById('max-users').value;
    expireTime = parseInt(document.getElementById('timer').value);
    
    // 房主生成房间主密钥
    aesKey = await generateKey();
    
    socket.emit('create-room', { maxUsers });
}

socket.on('room-created', async ({ roomId, password }) => {
    currentRoom = roomId;
    alert(`创建成功！\n请将以下信息通过安全渠道发送给对方：\n房间ID: ${roomId}\n8位密码: ${password}`);
    enterChatroom();
});

socket.on('join-request', async ({ socketId, passcode }) => {
    const alias = prompt(`有访客请求进入！\n对方暗号: ${passcode}\n请为他强制设置一个备注 (如: 01号):`);
    if (alias) {
        // 导出密钥发给访客（真实军用级需用RSA非对称加密此密钥，此处为演示简化为直接发送）
        const rawKey = await window.crypto.subtle.exportKey("raw", aesKey);
        socket.emit('approve-user', { roomId: currentRoom, targetSocketId: socketId, alias, sharedKey: rawKey });
    }
});

// ================= 2. 访客逻辑 =================
function requestJoin() {
    const roomId = document.getElementById('join-link').value;
    const password = document.getElementById('join-pwd').value;
    const passcode = document.getElementById('join-passcode').value;
    socket.emit('request-join', { roomId, password, passcode });
    alert('申请已发送，等待房主强制备注并批准...');
}

socket.on('join-approved', async ({ roomId, alias, sharedKey }) => {
    currentRoom = roomId;
    myAlias = alias;
    // 导入房主发来的主密钥
    aesKey = await window.crypto.subtle.importKey(
        "raw", sharedKey, "AES-GCM", true, ["encrypt", "decrypt"]
    );
    enterChatroom();
});

socket.on('error', (msg) => alert(`错误: ${msg}`));
socket.on('room-destroyed', () => { alert('房主已销毁房间，数据彻底抹除。'); location.reload(); });

// ================= 3. 军用级加密通讯 (E2EE) =================
async function sendMessage() {
    const text = document.getElementById('msg-input').value;
    if (!text) return;
    if (text.length > 24800) return alert('超过24800字限制');
    
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify({ alias: myAlias, text: text, time: Date.now() }));
    
    // AES-GCM 256位加密
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, encoded);
    
    socket.emit('encrypted-message', {
        roomId: currentRoom,
        encryptedBlob: { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) }
    });
    document.getElementById('msg-input').value = '';
}

socket.on('receive-message', async (encryptedBlob) => {
    try {
        const iv = new Uint8Array(encryptedBlob.iv);
        const data = new Uint8Array(encryptedBlob.data);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, data);
        const msgObj = JSON.parse(new TextDecoder().decode(decrypted));
        
        messages.push(msgObj);
        renderCanvas();
    } catch (e) {
        console.error("解密失败，可能受到中间人攻击");
    }
});

// ================= 4. 防读取与防查岗 (Canvas 核心) =================
const canvas = document.getElementById('chat-canvas');
const ctx = canvas.getContext('2d');

function enterChatroom() {
    document.getElementById('home').style.display = 'none';
    document.getElementById('chat-ui').style.display = 'block';
    resizeCanvas();
    // 启动时间胶囊：每秒检查一次，剔除过期消息
    setInterval(() => {
        const now = Date.now();
        const originalLength = messages.length;
        messages = messages.filter(m => (now - m.time) < (expireTime * 1000));
        if (messages.length !== originalLength) renderCanvas(); // 如果有删除则重新渲染
    }, 1000);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.8;
    renderCanvas();
}
window.addEventListener('resize', resizeCanvas);

function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制防截屏背景水印
    ctx.fillStyle = 'rgba(0, 255, 0, 0.03)';
    ctx.font = '30px monospace';
    for(let i=0; i<canvas.width; i+=150) {
        for(let j=0; j<canvas.height; j+=100) {
            ctx.fillText(myAlias, i, j); // 满屏铺满当前用户的名字
        }
    }

    // 绘制聊天文字 (防 DOM 抓取)
    ctx.fillStyle = '#0f0';
    ctx.font = '16px monospace';
    let y = 30;
    messages.forEach(m => {
        // 极简换行处理
        const text = `[${m.alias}]: ${m.text}`;
        const maxLineWidth = canvas.width - 40;
        let line = '';
        for (let n = 0; n < text.length; n++) {
            const testLine = line + text[n];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxLineWidth && n > 0) {
                ctx.fillText(line, 20, y);
                line = text[n];
                y += 24;
            } else { line = testLine; }
        }
        ctx.fillText(line, 20, y);
        y += 35; // 下一条消息间距
    });
}

// 防查岗机制：失去焦点瞬间黑屏
window.addEventListener('blur', () => { document.getElementById('panic-shield').style.display = 'block'; });
window.addEventListener('focus', () => { document.getElementById('panic-shield').style.display = 'none'; });

// 禁用右键和F12
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', (e) => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) e.preventDefault();
});
