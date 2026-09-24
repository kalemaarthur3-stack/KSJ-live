const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/*
========================================================
🎮 KSJ LIVE
GAME SERVER + WEBRTC SCREEN SHARE SIGNALING
========================================================
*/

const rooms = new Map();

/*
========================================================
🧠 QUESTIONS
========================================================
*/

const QUESTIONS = [
    {
        question: "Which animal is the fastest on land?",
        answers: ["Lion", "Cheetah", "Elephant", "Gorilla"],
        correct: 1
    },
    {
        question: "How many days are in a week?",
        answers: ["5", "6", "7", "8"],
        correct: 2
    },
    {
        question: "Which planet is known as the Red Planet?",
        answers: ["Earth", "Mars", "Jupiter", "Venus"],
        correct: 1
    },
    {
        question: "What is 10 + 5?",
        answers: ["12", "13", "15", "20"],
        correct: 2
    }
];

/*
========================================================
🔢 ROOM CODE
========================================================
*/

function createCode() {

    let code;

    do {
        code = String(
            Math.floor(
                100000 + Math.random() * 900000
            )
        );

    } while (rooms.has(code));

    return code;
}

/*
========================================================
👥 PUBLIC PLAYER LIST
========================================================
*/

function publicPlayers(room) {

    return [...room.players.values()].map(player => ({
        id: player.id,
        name: player.name,
        score: player.score
    }));
}

/*
========================================================
🏆 LEADERBOARD
========================================================
*/

function sendLeaderboard(room) {

    const leaderboard =
        publicPlayers(room)
            .sort((a, b) => b.score - a.score);

    io.to(room.code).emit(
        "leaderboard",
        leaderboard
    );
}

/*
========================================================
🔌 SOCKET CONNECTION
========================================================
*/

io.on("connection", socket => {

    console.log(
        "Connected:",
        socket.id
    );

    /*
    ====================================================
    👑 CREATE ROOM
    ====================================================
    */

    socket.on(
        "createRoom",
        ({ creatorName = "KSJ Creator" } = {}, callback) => {

            const code = createCode();

            const room = {

                code,

                creatorId:
                    socket.id,

                creatorName,

                players:
                    new Map(),

                currentQuestion:
                    null,

                questionIndex:
                    -1,

                active:
                    false,

                answered:
                    new Set(),

                screenSharer:
                    null

            };

            rooms.set(
                code,
                room
            );

            socket.join(code);

            socket.data.roomCode =
                code;

            socket.data.isCreator =
                true;

            callback?.({
                success: true,
                code
            });

            console.log(
                `Room ${code} created`
            );
        }
    );

    /*
    ====================================================
    👤 JOIN ROOM
    ====================================================
    */

    socket.on(
        "joinRoom",
        ({ code, name }, callback) => {

            code =
                String(code || "")
                    .trim();

            const room =
                rooms.get(code);

            if (!room) {

                return callback?.({
                    success: false,
                    error: "Room not found."
                });

            }

            if (room.players.size >= 100) {

                return callback?.({
                    success: false,
                    error: "This room is full."
                });

            }

            const cleanName =
                String(
                    name || "Player"
                )
                    .trim()
                    .slice(0, 20);

            const player = {

                id:
                    socket.id,

                name:
                    cleanName || "Player",

                score:
                    0

            };

            room.players.set(
                socket.id,
                player
            );

            socket.join(code);

            socket.data.roomCode =
                code;

            socket.data.isCreator =
                false;

            callback?.({
                success: true,
                code,
                player
            });

            io.to(code).emit(
                "playersUpdated",
                publicPlayers(room)
            );

            sendLeaderboard(room);

            /*
            Tell new viewer whether
            creator is currently sharing.
            */

            if (room.screenSharer) {

                socket.emit(
                    "screenShareActive",
                    {
                        sharerId:
                            room.screenSharer
                    }
                );

            }

            console.log(
                `${cleanName} joined ${code}`
            );
        }
    );

    /*
    ====================================================
    ▶️ START GAME
    ====================================================
    */

    socket.on(
        "startGame",
        callback => {

            const code =
                socket.data.roomCode;

            const room =
                rooms.get(code);

            if (
                !room ||
                room.creatorId !== socket.id
            ) {

                return callback?.({
                    success: false,
                    error:
                        "Only the creator can start the game."
                });

            }

            room.active = true;

            room.questionIndex = -1;

            startNextQuestion(room);

            callback?.({
                success: true
            });

        }
    );

    /*
    ====================================================
    ⏭️ NEXT QUESTION
    ====================================================
    */

    socket.on(
        "nextQuestion",
        callback => {

            const code =
                socket.data.roomCode;

            const room =
                rooms.get(code);

            if (
                !room ||
                room.creatorId !== socket.id
            ) {

                return callback?.({
                    success: false,
                    error:
                        "Only the creator can control the game."
                });

            }

            startNextQuestion(room);

            callback?.({
                success: true
            });

        }
    );

    /*
    ====================================================
    📝 ANSWER
    ====================================================
    */

    socket.on(
        "answer",
        ({ answer }, callback) => {

            const code =
                socket.data.roomCode;

            const room =
                rooms.get(code);

            if (
                !room ||
                !room.active ||
                !room.currentQuestion
            ) {

                return callback?.({
                    success: false,
                    error:
                        "There is no active question."
                });

            }

            const player =
                room.players.get(
                    socket.id
                );

            if (!player) {

                return callback?.({
                    success: false,
                    error:
                        "Player not found."
                });

            }

            /*
            Prevent multiple answers.
            */

            if (
                room.answered.has(
                    socket.id
                )
            ) {

                return callback?.({
                    success: false,
                    error:
                        "You already answered."
                });

            }

            const selected =
                Number(answer);

            if (
                !Number.isInteger(selected) ||
                selected < 0 ||
                selected >=
                    room.currentQuestion.answers.length
            ) {

                return callback?.({
                    success: false,
                    error:
                        "Invalid answer."
                });

            }

            room.answered.add(
                socket.id
            );

            const correct =
                selected ===
                room.currentQuestion.correct;

            if (correct) {

                player.score += 100;

            }

            callback?.({

                success: true,

                correct,

                score:
                    player.score

            });

            sendLeaderboard(room);

        }
    );

    /*
    ====================================================
    📱 SCREEN SHARE STARTED
    ====================================================
    */

    socket.on(
        "screenShareStarted",
        () => {

            const code =
                socket.data.roomCode;

            const room =
                rooms.get(code);

            if (!room) return;

            /*
            Only the creator can broadcast
            their screen.
            */

            if (
                room.creatorId !== socket.id
            ) {
                return;
            }

            room.screenSharer =
                socket.id;

            socket.to(code).emit(
                "screenShareActive",
                {
                    sharerId:
                        socket.id
                }
            );

            console.log(
                `Screen sharing started in ${code}`
            );

        }
    );

    /*
    ====================================================
    ⛔ SCREEN SHARE STOPPED
    ====================================================
    */

    socket.on(
        "screenShareStopped",
        () => {

            const code =
                socket.data.roomCode;

            const room =
                rooms.get(code);

            if (!room) return;

            if (
                room.creatorId !== socket.id
            ) {
                return;
            }

            room.screenSharer =
                null;

            io.to(code).emit(
                "screenShareStopped"
            );

            console.log(
                `Screen sharing stopped in ${code}`
            );

        }
    );

    /*
    ====================================================
    📡 WEBRTC OFFER
    ====================================================
    */

    socket.on(
        "screenOffer",
        ({ targetId, offer }) => {

            if (!targetId || !offer)
                return;

            io.to(targetId).emit(
                "screenOffer",
                {
                    senderId:
                        socket.id,

                    offer
                }
            );

        }
    );

    /*
    ====================================================
    📡 WEBRTC ANSWER
    ====================================================
    */

    socket.on(
        "screenAnswer",
        ({ targetId, answer }) => {

            if (!targetId || !answer)
                return;

            io.to(targetId).emit(
                "screenAnswer",
                {
                    senderId:
                        socket.id,

                    answer
                }
            );

        }
    );

    /*
    ====================================================
    🧊 WEBRTC ICE CANDIDATE
    ====================================================
    */

    socket.on(
        "screenIceCandidate",
        ({ targetId, candidate }) => {

            if (!targetId || !candidate)
                return;

            io.to(targetId).emit(
                "screenIceCandidate",
                {
                    senderId:
                        socket.id,

                    candidate
                }
            );

        }
    );

    /*
    ====================================================
    👋 DISCONNECT
    ====================================================
    */

    socket.on(
        "disconnect",
        () => {

            const code =
                socket.data.roomCode;

            if (!code)
                return;

            const room =
                rooms.get(code);

            if (!room)
                return;

            /*
            Stop screen sharing if creator leaves.
            */

            if (
                room.screenSharer ===
                socket.id
            ) {

                room.screenSharer =
                    null;

                io.to(code).emit(
                    "screenShareStopped"
                );

            }

            /*
            Remove player.
            */

            if (
                room.players.has(
                    socket.id
                )
            ) {

                room.players.delete(
                    socket.id
                );

            }

            io.to(code).emit(
                "playersUpdated",
                publicPlayers(room)
            );

            sendLeaderboard(room);

            /*
            Delete empty room.
            */

            if (
                room.players.size === 0 &&
                room.creatorId !== socket.id
            ) {

                rooms.delete(code);

            }

            console.log(
                "Disconnected:",
                socket.id
            );

        }
    );

});

/*
========================================================
❓ START NEXT QUESTION
========================================================
*/

function startNextQuestion(room) {

    room.questionIndex++;

    if (
        room.questionIndex >=
        QUESTIONS.length
    ) {

        room.active = false;

        room.currentQuestion =
            null;

        io.to(room.code).emit(
            "gameFinished"
        );

        sendLeaderboard(room);

        return;
    }

    room.currentQuestion =
        QUESTIONS[
            room.questionIndex
        ];

    room.answered.clear();

    const questionForPlayers = {

        number:
            room.questionIndex + 1,

        total:
            QUESTIONS.length,

        question:
            room.currentQuestion.question,

        answers:
            room.currentQuestion.answers

    };

    io.to(room.code).emit(
        "question",
        questionForPlayers
    );

    console.log(
        `Room ${room.code}: Question ${
            room.questionIndex + 1
        }`
    );
}

/*
========================================================
🌐 WEBSITE
========================================================
*/

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);

/*
========================================================
❤️ HEALTH CHECK
========================================================
*/

app.get(
    "/health",
    (req, res) => {

        res.json({

            status:
                "online",

            game:
                "KSJ Live",

            screenShare:
                "WebRTC signaling enabled"

        });

    }
);

/*
========================================================
🚀 START SERVER
========================================================
*/

server.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "🎮 KSJ LIVE SERVER"
        );

        console.log(
            "📡 WebRTC SCREEN SHARE ENABLED"
        );

        console.log(
            `🚀 Running on port ${PORT}`
        );

        console.log(
            "================================="
        );

    }
);