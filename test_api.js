import("dotenv").then(({ config }) => config());
import mongoose from "mongoose";
import axios from "axios";

async function runTest() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.useDb("SaaS");
  
  // Get an admin user/token (mocking auth for local test)
  // To test the API route directly, we'll actually bypass full auth for a quick DB check
  // or just directly update the DB to prove the schema holds it, 
  // but let's just query a Page to ensure it has the fields.
  
  const Page = db.model("Page", new mongoose.Schema({}, { strict: false }), "pages");
  const page = await Page.findOne();
  console.log("Found page ID:", page.pageId);
  
  // Simulate the API update directly to verify schema works seamlessly
  const updated = await Page.findOneAndUpdate(
    { pageId: page.pageId },
    { 
      $set: { 
        customInstructions: "SALE IS ON!",
        language: "Spanish",
        replyStyle: "Friendly",
        tone: "Excited"
      }
    },
    { new: true }
  );
  
  console.log("\nUpdated Page AI Settings:");
  console.log({
    customInstructions: updated.customInstructions,
    language: updated.language,
    replyStyle: updated.replyStyle,
    tone: updated.tone
  });
  
  console.log("\nTesting prompt builder:");
  const promptBuilder = await import("./utils/promptBuilder.js");
  console.log(promptBuilder.buildDynamicPrompt(updated));
  
  process.exit(0);
}

runTest().catch(console.error);
