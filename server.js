const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 提供静态文件
app.use(express.static('public'));

// 服务器内存中的房间（重启即焚）
const rooms = {};

io.on('connection', (socket) => {
    // 1. 创建房间
    socket.on('create-room', ({ maxUsers }) => {
        const roomId = Math.random().toString(36).substr(2, 9); // 随机链接ID
        const password = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8位随机密码
        
        rooms[roomId] = {
            host: socket.id,
            password: password,
            maxUsers: maxUsers > 15 ? 30 : 15, // 限制15或30
            users: {} // 存放成员及备注
        };
        
        socket.join(roomId);
        socket.emit('room-created', { roomId, password });
    });

    // 2. 申请加入
    socket.on('request-join', ({ roomId, password, passcode }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error', '房间不存在或已销毁');
        if (room.password !== password) return socket.emit('error', '8位密码错误');
        if (Object.keys(room.users).length >= room.maxUsers) return socket.emit('error', '房间人数已满');

        // 通知房主审核
        io.to(room.host).emit('join-request', { socketId: socket.id, passcode });
    });

    // 3. 房主批准并设置备注
    socket.on('approve-user', ({ roomId, targetSocketId, alias, sharedKey }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.users[targetSocketId] = alias;
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.join(roomId);
                // 把端到端加密的密钥（已被房主公钥加密或通过安全通道）发给访客
                io.to(targetSocketId).emit('join-approved', { roomId, alias, sharedKey });
                // 通知所有人更新列表
                io.to(roomId).emit('update-users', Object.values(room.users));
            }
        }
    });

    // 4. 转发加密消息 (服务器无法解密)
    socket.on('encrypted-message', ({ roomId, encryptedBlob }) => {
        // 连发送者的名字都不看，直接广播给房间所有人（包括自己，用于确认）
        io.to(roomId).emit('receive-message', encryptedBlob);
    });

    // 5. 房主断开，彻底销毁房间
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].host === socket.id) {
                io.to(roomId).emit('room-destroyed');
                delete rooms[roomId]; // 内存抹除
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
