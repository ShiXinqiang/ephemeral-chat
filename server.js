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
            users: { [socket.id]: '👑 房主 (我)' } // 初始包含自己
        };
        socket.join(roomId);
        socket.emit('room-created', { roomId, password, myId: socket.id });
    });

    socket.on('request-join', ({ roomId, password, passcode }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error', '房间不存在');
        if (room.password !== password) return socket.emit('error', '密码错误');
        if (Object.keys(room.users).length >= room.maxUsers) return socket.emit('error', '房间已满');
        io.to(room.host).emit('join-request', { socketId: socket.id, passcode });
    });

    socket.on('approve-user', ({ roomId, targetSocketId, alias, sharedKey }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.users[targetSocketId] = alias;
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.join(roomId);
                io.to(targetSocketId).emit('join-approved', { roomId, alias, sharedKey, myId: targetSocketId });
                io.to(roomId).emit('update-users', room.users);
            }
        }
    });

    // --- 新增：房主高级操作 ---
    
    // 1. 刷新密码
    socket.on('refresh-password', (roomId) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.password = Math.floor(10000000 + Math.random() * 90000000).toString();
            socket.emit('password-updated', room.password);
        }
    });

    // 2. 修改成员备注
    socket.on('change-alias', ({ roomId, targetId, newAlias }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id && room.users[targetId]) {
            room.users[targetId] = newAlias;
            io.to(roomId).emit('update-users', room.users);
        }
    });

    // 3. 移除成员 (踢人)
    socket.on('kick-user', ({ roomId, targetId }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id && targetId !== socket.id) {
            delete room.users[targetId];
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.leave(roomId);
                io.to(targetId).emit('kicked');
            }
            io.to(roomId).emit('update-users', room.users);
        }
    });

    // 消息转发
    socket.on('encrypted-message', ({ roomId, encryptedBlob, senderId }) => {
        io.to(roomId).emit('receive-message', { encryptedBlob, senderId });
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].host === socket.id) {
                io.to(roomId).emit('room-destroyed');
                delete rooms[roomId];
            } else if (rooms[roomId].users[socket.id]) {
                delete rooms[roomId].users[socket.id];
                io.to(roomId).emit('update-users', rooms[roomId].users);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
