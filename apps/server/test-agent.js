const fs = require('fs');
const path = require('path');

console.log('🔍 Testing Coding Agent Setup...\n');

// Test 1: Check if all required files exist
const requiredFiles = [
  'src/llm.ts',
  'src/chat.ts',
  'src/tool-executor.ts',
  'src/coding-agent.ts',
  'src/prompt/tools.json',
  'src/prompt/system.ts',
  'src/prompt/tools.ts'
];

console.log('✅ Checking required files...');
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`  ✓ ${file}`);
  } else {
    console.log(`  ✗ ${file} - MISSING`);
  }
}

// Test 2: Check tools.json structure
console.log('\n✅ Checking tools.json structure...');
try {
  const toolsPath = path.join(__dirname, 'src/prompt/tools.json');
  const toolsContent = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
  
  if (Array.isArray(toolsContent)) {
    console.log(`  ✓ Found ${toolsContent.length} tools defined`);
    
    // Check each tool has required structure
    for (const tool of toolsContent.slice(0, 3)) { // Check first 3 tools
      if (tool.name && tool.description && tool.parameters) {
        console.log(`    ✓ ${tool.name} - properly structured`);
      } else {
        console.log(`    ✗ ${tool.name} - missing required properties`);
      }
    }
  } else {
    console.log('  ✗ tools.json should be an array');
  }
} catch (error) {
  console.log(`  ✗ Error reading tools.json: ${error.message}`);
}

// Test 3: Check package.json dependencies
console.log('\n✅ Checking package.json dependencies...');
try {
  const packagePath = path.join(__dirname, 'package.json');
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
  
  const requiredDeps = ['ai', '@ai-sdk/anthropic', '@ai-sdk/openai', 'zod'];
  
  for (const dep of requiredDeps) {
    if (packageContent.dependencies[dep]) {
      console.log(`  ✓ ${dep} - ${packageContent.dependencies[dep]}`);
    } else {
      console.log(`  ✗ ${dep} - MISSING`);
    }
  }
} catch (error) {
  console.log(`  ✗ Error reading package.json: ${error.message}`);
}

// Test 4: Check TypeScript compilation
console.log('\n✅ Checking TypeScript compilation...');
const { execSync } = require('child_process');

try {
  execSync('npx tsc --noEmit', { 
    stdio: 'pipe', 
    cwd: __dirname 
  });
  console.log('  ✓ TypeScript compilation successful');
} catch (error) {
  console.log('  ✗ TypeScript compilation failed');
  console.log('    Run `npm run check-types` for details');
}

console.log('\n🎯 Coding Agent Setup Test Complete!');
console.log('\nTo test the agent:');
console.log('1. Set up your API keys in environment variables');
console.log('2. Run `npm run dev` to start the server');
console.log('3. Use the REST API endpoints or WebSocket connection');
console.log('\nAPI Endpoints:');
console.log('- POST /api/coding-agent/create - Create new task');
console.log('- POST /api/coding-agent/execute - Execute task');
console.log('- GET /api/coding-agent/tools - List available tools');