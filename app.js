import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import http from "http";

const PORT = process.env.PORT || 8000;
const app = express();

const corsOptions = {
    origin: [
        "http://localhost:3000",
        "https://sparkly-wisp-3523f7.netlify.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
};

app.use(cors(corsOptions));


const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:3000",
            "https://sparkly-wisp-3523f7.netlify.app"
        ],
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
    maxHttpBufferSize: 1e6
});

io.on("connection", (socket) => {
    let userId = socket.handshake.query.userId;
    socket.selectedUsersMap = new Map();
    if (userId) {
        setTimeout(() => {
            socket.userId = userId;
            socket.selectedUsersMap.set(userId, 0);
            socket.join(userId);
            const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => s.userId);
            socket.emit("onlineUsers", onlineUsers);
            socket.broadcast.emit("userOnline", { userId });
            console.log(onlineUsers)
        }, 2000)
    }

    // Handle disconnection
    socket.on("disconnect", () => {
        const userId = socket.userId;
        if (userId) {
            socket.selectedUsersMap.clear();
            socket.broadcast.emit("userOffline", { userId });
            // console.log(userId, "out")
        }
    });


})

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});