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
            userOrder: [socket.id], // 用于记录加入顺序，方便继承
            users: { [socket.id]: '👑 房主 (我)' }
        };
        socket.join(roomId);
        socket.emit('room-created', { roomId, password, myId: socket.id });
    });

    socket.on('request-join', ({ roomId, password, passcode }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('sys-toast', { msg: '房间不存在', type: 'error' });
        if (room.password !== password) return socket.emit('sys-toast', { msg: '密码错误', type: 'error' });
        if (Object.keys(room.users).length >= room.maxUsers) return socket.emit('sys-toast', { msg: '房间已满', type: 'error' });
        
        // 发送给当前房主（无论是不是初创者）
        io.to(room.host).emit('join-request', { socketId: socket.id, passcode });
        socket.emit('sys-toast', { msg: '申请已发送，请等待房主审批...', type: 'info' });
    });

    socket.on('approve-user', ({ roomId, targetSocketId, alias, sharedKey }) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.users[targetSocketId] = alias;
            room.userOrder.push(targetSocketId); // 加入顺序列表
            
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            if (targetSocket) {
                targetSocket.join(roomId);
                io.to(targetSocketId).emit('join-approved', { roomId, alias, sharedKey, myId: targetSocketId });
                io.to(roomId).emit('update-users', room.users);
            }
        }
    });

    socket.on('reject-user', (targetSocketId) => {
        io.to(targetSocketId).emit('sys-toast', { msg: '房主拒绝了您的加入申请', type: 'error' });
    });

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
                    // 房间没人了，物理销毁
                    delete rooms[roomId];
                } else if (room.host === socket.id) {
                    // 房主走了，顺位第二个人继承
                    room.host = room.userOrder[0];
                    room.users[room.host] = '👑 ' + room.users[room.host].replace('👑 ', ''); // 加上皇冠
                    
                    io.to(room.host).emit('you-are-new-host', room.password);
                    io.to(roomId).emit('sys-toast', { msg: '原房主已离线，权限已移交', type: 'info' });
                    io.to(roomId).emit('update-users', room.users);
                } else {
                    // 普通人走了，更新列表即可
                    io.to(roomId).emit('update-users', room.users);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
