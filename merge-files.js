const fs = require("fs");
const path = require("path");
const git = require("isomorphic-git");
const http = require("isomorphic-git/http/node");
const readline = require("readline");

// Utility function to ask yes/no or choice question
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// Load config.json initially 
let config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config/config.json"), "utf8")
);

// Load templates
const codeTpl = fs.readFileSync(
  path.join(__dirname, "config/code.tpl"),
  "utf8"
);

let totalFiles = 0;
let totalLines = 0;
const langLines = {};

// Recursive function to read files and build tree
function readAndMerge(dir, baseDir, level, result) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stats = fs.statSync(fullPath);

    // Skip excluded files/folders
    if (config.excludes.some((ex) => file.match(ex))) {
      return;
    }

    if (stats.isDirectory()) {
      result.tree += `${"  ".repeat(level)}- ${file}\n`;
      readAndMerge(fullPath, path.join(baseDir, file), level + 1, result);
    } else {
   
      // Only add file to tree if it matches the allowed extensions
      if (config.includes.some((ext) => file.endsWith(ext))) {
        result.tree += `${"  ".repeat(level)}- ${file}\n`;

        const content = fs.readFileSync(fullPath, "utf8");

        const lines = content.split('\n').length;
        totalFiles++;
        totalLines += lines;
        const ext = path.extname(file).toLowerCase();
        const lang = ext.slice(1);
        langLines[lang] = (langLines[lang] || 0) + lines;

        // Apply code.tpl template
        const fileBlock = codeTpl
          .replace("{{filename}}", path.join(baseDir, file))
          .replace("{{filecontent}}", content);

        result.contents += fileBlock + "\n";
      }
      
    }
  });
}

// Check if input is a GitHub URL
function isGitUrl(str) {
  return (
    (str.startsWith("http://") || str.startsWith("https://")) && str.endsWith(".git")
  );
}

// Clone repo if GitHub URL is given
async function cloneRepo(gitUrl) {
  const tempDir = path.join(__dirname, "temp-repo");

  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`Cloning repository: ${gitUrl}`);

  await git.clone({
    fs,
    http,
    dir: tempDir,
    url: gitUrl,
    singleBranch: true,
    depth: 1,
  });

  return tempDir;
}

// Detect project type based on files present
function detectProjectType(sourceDir) {
  const files = fs.readdirSync(sourceDir);

  if (files.includes("package.json")) 
    return "node";
  if (files.includes("requirements.txt") || files.some((f) => f.endsWith(".py")))
    return "python";
  if (files.includes("pom.xml") || files.some((f) => f.endsWith(".java")))
    return "java";
  if (files.some((f) => f.endsWith(".csproj"))) return "dotnet";
  return "unknown";
}

// Main function
async function main() {
  const inputPath = process.argv[2]; // local path or GitHub URL

  if (!inputPath) {
    console.error("Please provide a source directory or GitHub repo URL");
    return;
  }

  let sourceDir = inputPath;

  if (isGitUrl(inputPath)) {
    sourceDir = await cloneRepo(inputPath);
  }

  if (!fs.existsSync(sourceDir)) {
    console.error(`Error: Source directory '${sourceDir}' does not exist!`);
    return;
  }

  // Define default includes/excludes per project type
  const projectFileMap = {
    node: {
      includes: [".js", ".ts", ".tsx", ".jsx", ".json", ".html", ".css"],
      excludes: ["node_modules", "dist", "build", "public", "package-lock.json", ".git"],
    },
    python: {
      includes: [".py", ".yml", ".ini"],
      excludes: ["venv", "__pycache__", ".git"],
    },
    java: {
      includes: [".java", ".xml", ".properties"],
      excludes: ["target", "bin", ".git"],
    },
    dotnet: {
      includes: [".cs", ".config"],
      excludes: ["bin", "obj", ".git"],
    },
  };

  // Step 1: Detect project type & ask YES/NO
  const projectType = detectProjectType(sourceDir);
  console.log(`Detected project type: ${projectType}`);

  if (projectType !== "unknown" && projectFileMap[projectType]) {
    const answer = await askQuestion(
      `We detected a ${projectType} project. Use default includes/excludes? (Y/N): `
    );

    if (answer === "y" || answer === "yes") {
      console.log("Using project defaults");
      config.includes = projectFileMap[projectType].includes;
      config.excludes = projectFileMap[projectType].excludes;
    } else {
      console.log("Using config.json includes/excludes only");
      const userConfig = JSON.parse(
        fs.readFileSync(path.join(__dirname, "config/config.json"), "utf8")
      );
      config.includes = userConfig.includes;
      config.excludes = userConfig.excludes;
    }
  } else {
    console.log("Unknown project type → using config.json values");
    const userConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, "config/config.json"), "utf8")
    );
    config.includes = userConfig.includes;
    config.excludes = userConfig.excludes;
  }

    console.log(`
Please select one option:
1) Analyse the source code and provide an overview
2) Extract the feature list and create a CSV file
3) Generate a README.MD file
4) No additional prompt
5) Generate import/export relationships

`);
  

const choice = await askQuestion("Enter your choice (1-5): ");
let tplFile = "";

switch (choice) {
  case "1":
    tplFile = path.join(__dirname, "config/analyze.tpl");
    break;
  case "2":
    tplFile = path.join(__dirname, "config/features.tpl");
    break;
  case "3":
    tplFile = path.join(__dirname, "config/readme.tpl");
    break;
  case "4":
    tplFile = path.join(__dirname, "config/prompt.tpl");
    break;
  case "5":
      tplFile = path.join(__dirname, "config/imports.tpl");
   
}

  //Build tree & contents using final config
  let result = { tree: "", contents: "" };
  readAndMerge(sourceDir, "", 0, result);

  //Generate output using chosen template
  const chosenTpl = fs.readFileSync(tplFile, "utf8");
  const finalOutput = chosenTpl
    .replace("{{tree}}", result.tree)
    .replace("{{contents}}", result.contents);

  fs.writeFileSync(config.outputFile, finalOutput);
  console.log(`Successfully generated output: ${config.outputFile}`);

  console.log(`\nProcessed ${totalFiles} files, ${totalLines} lines`);
  for (const lang in langLines) {
    console.log(`- ${lang.charAt(0).toUpperCase() + lang.slice(1)}: ${langLines[lang]}`);
  }
}

main().catch((err) => console.error("Error:", err));


