// Singleton socket.io instance shared across modules
let io = null;

export const setIO = (ioInstance) => {
    io = ioInstance;
};

export const getIO = () => io;
