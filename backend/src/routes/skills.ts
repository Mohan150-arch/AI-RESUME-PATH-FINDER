import { Router } from "express";
import { skillGapHandler } from "../services/skillGapController";
import { KnowledgeGraph } from "../services/skillGapEngine";

export const skillsRouter = Router();

// POST /skills/gap
skillsRouter.post("/gap", skillGapHandler);

// POST /skills/learning-path - Get detailed learning path for a specific skill
skillsRouter.post("/learning-path", async (req, res) => {
  const { skill, currentSkills } = req.body;

  if (!skill) {
    return res.status(400).json({
      error: "skill is required"
    });
  }

  try {
    const knowledgeGraph = new KnowledgeGraph();
    const learningPath = knowledgeGraph.generateLearningPath(
      skill,
      currentSkills || []
    );

    // Learning paths are always generated now
    res.json({ learningPath });
  } catch (error) {
    console.error("Learning path generation error:", error);
    res.status(500).json({ error: "Failed to generate learning path" });
  }
});


