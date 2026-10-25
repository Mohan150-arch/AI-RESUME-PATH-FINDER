import { Request, Response } from "express";
import { JobItem } from "../types";
import { computeSkillGaps } from "./skillGapEngine";

export async function skillGapHandler(req: Request, res: Response) {
  const { resumeSkills, jobs, topN } = req.body || {};
  // Lazy import to avoid circular deps and heavy initialization when not needed
  const { KnowledgeGraph } = await import("./skillGapEngine");

  if (!Array.isArray(resumeSkills) || resumeSkills.length === 0) {
    return res.status(400).json({ error: "resumeSkills array is required" });
  }

  // Handle empty jobs array gracefully
  if (!Array.isArray(jobs)) {
    return res.status(400).json({ error: "jobs must be an array" });
  }

  if (jobs.length === 0) {
    // Return empty gaps if no jobs provided
    return res.json({ gaps: [] });
  }

  try {
    const typedJobs: JobItem[] = jobs;
    const gaps = computeSkillGaps(resumeSkills, typedJobs, topN || 5);
    const knowledgeGraph = new KnowledgeGraph();

    // Ensure ALL skill gaps have comprehensive learning resources with knowledge graphs
    const prioritizedGaps = gaps.map((gap, index) => {
      // Always ensure a learningPath with knowledge graph exists for EVERY skill gap
      if (!gap.learningPath) {
        console.log(`Generating learning path for skill gap: ${gap.skill}`);
        gap.learningPath = knowledgeGraph.generateLearningPath(
          gap.skill,
          resumeSkills
        );
      }

      // Ensure all learning paths have knowledge graphs
      if (gap.learningPath && !gap.learningPath.knowledgeGraph) {
        console.log(`Learning path missing knowledge graph for: ${gap.skill}, regenerating...`);
        gap.learningPath = knowledgeGraph.generateLearningPath(
          gap.skill,
          resumeSkills
        );
      }

      // Set priority levels
      let priority: "high" | "medium" | "low" = "medium";
      if (index < 2) {
        priority = "high";
      } else if (index < 5) {
        priority = "medium";
      } else {
        priority = "low";
      }

      return {
        ...gap,
        hasDetailedRoadmap: true,
        priority,
      };
    });

    res.json({ gaps: prioritizedGaps });
  } catch (err) {
    console.error("Skill gap computation error:", err);
    res.status(500).json({ error: "Failed to compute skill gaps" });
  }
}



