import { NodeRegistry, buildChain } from './modules.js';

// 音效引擎：负责播放/切换/销毁链，以及模块链的持久化保存。
// 切换音效时 stop() 会停止所有源节点、断开全部节点并从注册表移除，
// 保证旧链不残留声音、不占用处理器。
export class SfxEngine {
  constructor(ctx, storage = null) {
    this.ctx = ctx;
    this.registry = new NodeRegistry();
    this.current = null;
    this.currentName = null;
    this.storage = storage; // { getItem(k), setItem(k,v) }，浏览器传 localStorage
  }

  get activeNodeCount() {
    return this.registry.count;
  }

  play(name, def, when) {
    this.stop();
    const chain = buildChain(this.ctx, def, this.registry);
    chain.output.connect(this.ctx.destination);
    chain.start(when);
    this.current = chain;
    this.currentName = name;
    return chain;
  }

  stop() {
    if (this.current) {
      this.current.dispose();
      this.current = null;
      this.currentName = null;
    }
  }

  saveChain(name, def) {
    const all = this.loadAllChains();
    all[name] = def;
    if (this.storage) this.storage.setItem('sfx-chains', JSON.stringify(all));
    return all;
  }

  loadAllChains() {
    if (!this.storage) return {};
    try {
      return JSON.parse(this.storage.getItem('sfx-chains') || '{}');
    } catch (_) {
      return {};
    }
  }

  loadChain(name) {
    return this.loadAllChains()[name] || null;
  }
}
