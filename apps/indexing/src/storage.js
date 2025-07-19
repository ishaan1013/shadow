const fs = require('fs');
const path = require('path');
const { CodeGraph } = require('./graph');

// ---------------- Graph JSON ----------------
function saveGraph(graph,outDir){
  if(!fs.existsSync(outDir)) fs.mkdirSync(outDir,{recursive:true});
  const obj = graph.toJSON();
  // strip inlined embeddings
  for(const n of obj.nodes){
    delete n.embedding;
  }
  fs.writeFileSync(path.join(outDir,'graph.json'), JSON.stringify(obj,null,2),'utf8');
}

function loadGraph(outDir){
  const p = path.join(outDir,'graph.json');
  if(!fs.existsSync(p)) throw new Error(`graph.json not found in ${outDir}`);
  const obj = JSON.parse(fs.readFileSync(p,'utf8'));
  return CodeGraph.fromJSON(obj);
}

// ---------------- Embeddings (optional) ----------------
function saveEmbeddings(graph, outDir) {
  const chunks = [...graph.nodes.values()].filter(
    (n) => n.kind === 'CHUNK' && n.embedding
  );
  if (chunks.length === 0) return;

  // Ensure output directory exists before writing any files
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const idx = {};
  const allVecs = [];
  let offset = 0;

  for (const chunk of chunks) {
    const vec = chunk.embedding;
    idx[chunk.id] = { offset, length: vec.length };
    allVecs.push(...vec);
    offset += vec.length;
  }

  const dim = chunks[0].embedding.length;
  const f32 = new Float32Array(allVecs);
  const buf = Buffer.from(f32.buffer);

  fs.writeFileSync(
    path.join(outDir, 'embeddings.idx.json'),
    JSON.stringify({ dim, idx }),
    'utf8'
  );
  fs.writeFileSync(path.join(outDir, 'embeddings.f32'), buf);
}

function loadEmbeddings(graph,outDir){
  // if embedding files exist from prior run, load them
  const idxPath = path.join(outDir,'embeddings.idx.json');
  const binPath = path.join(outDir,'embeddings.f32');
  if(!fs.existsSync(idxPath) || !fs.existsSync(binPath)) return;
  const {dim,idx} = JSON.parse(fs.readFileSync(idxPath,'utf8'));
  const buf = fs.readFileSync(binPath);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength/4);
  for(const [id,{offset,length}] of Object.entries(idx)){
    const slice = f32.subarray(offset, offset+length);
    const node = graph.get(id);
    if(node){
      node.embedding = new Float32Array(slice);
      if(node.meta) node.meta.embedding_dim = dim;
      else node.meta = {embedding_dim:dim};
    }
  }
}

// ---------------- Inverted Lexical Index ----------------
function buildInverted(graph,outDir){
  const idx = {};
  for(const node of graph.nodes.values()){
    const textParts = [];
    if(node.code) textParts.push(node.code);
    if(node.signature) textParts.push(node.signature);
    if(node.name) textParts.push(node.name);
    const toks = tokenize(textParts.join('\n'));
    for(const t of toks){
      if(typeof t === 'string' && t.length > 0) {
      if(!idx[t]) idx[t] = new Set();
      idx[t].add(node.id);
      }
    }
  }
  const serial = {};
  for(const [k,v] of Object.entries(idx)) serial[k] = [...v];
  fs.writeFileSync(path.join(outDir,'inverted.json'), JSON.stringify(serial),'utf8');
}

function loadInverted(outDir){
  const p = path.join(outDir,'inverted.json');
  if(!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p,'utf8'));
}

// ---------------- Tokenization ----------------
function normTok(t){ return t.toLowerCase().replace(/[^a-z0-9_]+/g,''); }
function tokenize(text){ return text.split(/[^A-Za-z0-9_]+/).map(normTok).filter(Boolean); }

module.exports = {
  saveGraph, loadGraph,
  saveEmbeddings, loadEmbeddings,
  buildInverted, loadInverted,
  tokenize, normTok,
};
