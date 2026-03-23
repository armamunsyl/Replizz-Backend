import mongoose from "mongoose";

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log("Mongo URI:", process.env.MONGO_URI);
        console.log("Cluster host:", mongoose.connection.host);
        console.log("Database:", mongoose.connection.name);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB;
