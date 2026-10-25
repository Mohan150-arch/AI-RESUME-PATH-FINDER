import axios from "axios";
import pdfParse from "pdf-parse";
import { ResumeProfile } from "../types";

async function fileBufferToText(buffer: Buffer, mimetype?: string): Promise<string> {
  if (mimetype === "application/pdf") {
    const data = await pdfParse(buffer);
    return data.text;
  }

  // For now treat everything else as UTF-8 text
  return buffer.toString("utf8");
}

function buildPrompt(text: string): string {
  return `You are an expert resume parser. Extract ALL relevant information from the resume text below.

CRITICAL: Return ONLY valid JSON, no markdown code blocks, no explanations, no comments. Start with { and end with }.

Required JSON structure:
{
  "name": "Full Name or null",
  "email": "email@example.com or null",
  "phone": "+1234567890 or null",
  "location": "City, State/Country or null",
  "summary": "Professional summary paragraph or null",
  "skills": ["skill1", "skill2", "skill3"],
  "projects": [
    {
      "name": "Project Name",
      "description": "Brief description",
      "technologies": ["tech1", "tech2"]
    }
  ],
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "startDate": "YYYY-MM or YYYY",
      "endDate": "YYYY-MM or YYYY or null",
      "description": "Job description",
      "skills": ["skill1", "skill2"]
    }
  ]
}

EXTRACTION RULES:
1. Extract ALL technical skills mentioned anywhere (programming languages, frameworks, tools, platforms, methodologies)
2. Include skills from: education, experience, projects, certifications, skills section
3. Normalize skills: lowercase, remove duplicates, use common names (e.g., "JS" -> "javascript", "React.js" -> "react")
4. For experience: extract job title, company, dates, description, and ALL technologies/skills used
5. For projects: extract name, description, and ALL technologies used
6. Extract summary from objective, summary, or first paragraph if available

COMMON SKILLS TO LOOK FOR:
Programming: javascript, typescript, python, java, c++, c#, go, rust, php, ruby, swift, kotlin
Web: react, vue, angular, nextjs, nodejs, express, django, flask, spring, asp.net
Databases: mysql, postgresql, mongodb, redis, sqlite, oracle
Cloud: aws, azure, gcp, docker, kubernetes, terraform
Tools: git, jenkins, jira, figma, postman
Concepts: machine learning, ai, data science, devops, agile, scrum

RESUME TEXT:
${text.substring(0, 8000)}
`;
}

async function callGroq(prompt: string): Promise<ResumeProfile> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-70b-versatile",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  const content = response.data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from Groq");
  }

  // Content should be pure JSON per prompt instructions
  // Try to extract JSON if wrapped in markdown code blocks
  let jsonText = content.trim();
  if (jsonText.startsWith("```")) {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      jsonText = match[1];
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseErr) {
    console.error("Failed to parse Groq JSON response:", jsonText.substring(0, 200));
    throw new Error(`Invalid JSON from Groq: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
  }

  const profile: ResumeProfile = {
    name: parsed.name ?? undefined,
    email: parsed.email ?? undefined,
    phone: parsed.phone ?? undefined,
    location: parsed.location ?? undefined,
    summary: parsed.summary ?? undefined,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    experience: Array.isArray(parsed.experience) ? parsed.experience : [],
  };

  return profile;
}

export async function parseResumeWithLLM(
  buffer: Buffer,
  mimetype?: string
): Promise<ResumeProfile> {
  let text: string;
  try {
    text = await fileBufferToText(buffer, mimetype);
    if (!text || text.trim().length === 0) {
      throw new Error("Resume file appears to be empty or could not be parsed");
    }
  } catch (err) {
    console.error("Error parsing file:", err);
    throw new Error(`Failed to extract text from resume: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    return await callGroq(buildPrompt(text));
  } catch (err) {
    console.error("Error calling Groq LLM:", err);
    // Enhanced fallback: better skill extraction using regex patterns
    const lowerText = text.toLowerCase();
    
    // Comprehensive skill keywords
    const skillKeywords = [
      // Languages
      "javascript", "typescript", "python", "java", "c++", "c#", "go", "rust", "php", "ruby", "swift", "kotlin",
      // Web Frameworks
      "react", "vue", "angular", "nextjs", "nuxt", "svelte", "node", "nodejs", "express", "nestjs",
      "django", "flask", "fastapi", "spring", "spring boot", "asp.net", "laravel", "rails",
      // Databases
      "mysql", "postgresql", "postgres", "mongodb", "redis", "sqlite", "oracle", "sql server", "dynamodb",
      // Cloud & DevOps
      "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "k8s", "terraform", "ansible",
      // Tools & Others
      "git", "jenkins", "jira", "figma", "postman", "graphql", "rest api",
      // Concepts
      "machine learning", "ml", "ai", "artificial intelligence", "data science", "devops", "ci/cd", "agile", "scrum",
      // Frontend
      "html", "css", "sass", "scss", "tailwind", "bootstrap", "webpack", "vite",
      // Mobile
      "react native", "flutter", "ios", "android"
    ];
    
    const detectedSkills = new Set<string>();
    for (const skill of skillKeywords) {
      const pattern = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(lowerText)) {
        detectedSkills.add(skill.toLowerCase());
      }
    }
    
    // Extract name (first line or after "name:")
    let name: string | undefined;
    const nameMatch = text.match(/(?:^|\n)\s*(?:name|full name)[:\s]+([^\n]+)/i) || 
                     text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
    if (nameMatch) name = nameMatch[1]?.trim();
    
    // Extract email
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    const email = emailMatch ? emailMatch[0] : undefined;
    
    return {
      name,
      email,
      summary: text.slice(0, 500),
      skills: Array.from(detectedSkills),
      projects: [],
      experience: [],
    };
  }
}


