const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    socket.on('create-room', ({ maxUsers }) => {
        const roomId = Math.random().toString(36).substr(2, 9);
        const password = Math.floor(10000000 + Math.random() * 90000000).toString();
        
        rooms[roomId] = {
            host: socket.id,
            password: password,
            maxUsers: maxUsers > 15 ? 30 : 15,
            userOrder: [socket.id],
            users: { [socket.id]: '👑 房主 (我)' },
            // --- 反轰炸防御机制 ---
            pendingUsers: new Set(), // 当前正在排队的 ID
            blockedUsers: new Set()  // 被拉黑的 ID
        };
        socket.join(roomId);
        socket.emit('room-created', { roomId, password, myId: socket.id });
    });

    socket.on('request-join', ({ roomId, password, passcode }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('sys-toast', { msg: '房间不存在', type: 'error' });
        if (room.password !== password) return socket.emit('sys-toast', { msg: '密码错误', type: 'error' });
        if (Object.keys(room.users).length >= room.maxUsers) return socket.emit('sys-toast', { msg: '房间已满', type: 'error' });
        
        // --- 核心拦截逻辑 ---
        if (room.blockedUsers.has(socket.id)) return socket.emit('sys-toast', { msg: '您已被拒绝访问该对话', type: 'error' });
        if (room.pendingUsers.has(socket.id)) return socket.emit('sys-toast', { msg: '请勿重复申请，正在等待审批', type: 'error' });
        if (room.pendingUsers.size >= 20) return socket.emit('sys-toast', { msg: '申请队列已满，请稍后再试', type: 'error' });

        // 加入排队集合
        room.pendingUsers.add(socket.id);
        
        io.to(room.host).emit('join-request', { socketId: socket.id, passcode });
        socket.emit('sys-toast', { msg: '申请已发送，请等待房主审批...', type: 'success' });
    });

    socket.on('approve-user', ({ roomId, targetSocketId, alias, sharedKey }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.pendingUsers.delete(targetSocketId); // 从队列移除
            room.users[targetSocketId] = alias;
            room.userOrder.push(targetSocketId);
            
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.join(roomId);
                io.to(targetSocketId).emit('join-approved', { roomId, alias, sharedKey, myId: targetSocketId });
                io.to(roomId).emit('update-users', room.users);
            }
        }
    });

    socket.on('reject-user', ({ roomId, targetSocketId, block }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.pendingUsers.delete(targetSocketId); // 从队列移除
            if (block) {
                room.blockedUsers.add(targetSocketId); // 永久拉黑该设备
            }
            io.to(targetSocketId).emit('sys-toast', { msg: block ? '您已被拉黑' : '房主拒绝了您的申请', type: 'error' });
        }
    });

    // ... 下方保留之前的逻辑（刷新密码、踢人、发消息、断开连接）
    socket.on('refresh-password', (roomId) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.password = Math.floor(10000000 + Math.random() * 90000000).toString();
            socket.emit('password-updated', room.password);
        }
    });

    socket.on('change-alias', ({ roomId, targetId, newAlias }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id && room.users[targetId]) {
            room.users[targetId] = newAlias;
            io.to(roomId).emit('update-users', room.users);
        }
    });

    socket.on('kick-user', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id && targetId !== socket.id) {
            delete room.users[targetId];
            room.userOrder = room.userOrder.filter(id => id !== targetId);
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.leave(roomId);
                io.to(targetId).emit('kicked');
            }
            io.to(roomId).emit('update-users', room.users);
        }
    });

    socket.on('encrypted-message', ({ roomId, encryptedBlob, senderId }) => {
        io.to(roomId).emit('receive-message', { encryptedBlob, senderId });
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.users[socket.id]) {
                delete room.users[socket.id];
                room.userOrder = room.userOrder.filter(id => id !== socket.id);

                if (room.userOrder.length === 0) {
                    delete rooms[roomId];
                } else if (room.host === socket.id) {
                    room.host = room.userOrder[0];
                    room.users[room.host] = '👑 ' + room.users[room.host].replace('👑 ', '');
                    room.pendingUsers.clear(); // 换房主时清空申请列表防作弊
                    io.to(room.host).emit('you-are-new-host', room.password);
                    io.to(roomId).emit('sys-toast', { msg: '原房主已离线，权限已移交', type: 'info' });
                    io.to(roomId).emit('update-users', room.users);
                } else {
                    io.to(roomId).emit('update-users', room.users);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
