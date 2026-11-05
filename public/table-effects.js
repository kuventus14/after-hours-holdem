import * as THREE from './vendor/three.module.js';

// Presentation only. Runs on the table's existing render loop; never delays a game event.
export class TableEffects {
  constructor(scene, compact) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.compact = compact;
    this.effects = [];
    this.enabled = true;
    this.color = new THREE.Color(0x66f4d0);
  }

  disposeObject(object) {
    object.geometry?.dispose();
    object.material?.dispose();
    object.removeFromParent();
  }

  configure(a, b) {
    this.root.children.slice().forEach(object => this.disposeObject(object));
    this.effects = [];
    this.a = a + .5; this.b = b + .5;
    const material = (color, opacity) => new THREE.MeshBasicMaterial({color, transparent:true, opacity, depthWrite:false, toneMapped:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending});
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, .004, 5, 128), material(0x66dcca, .55));
    rail.rotation.x = -Math.PI / 2;
    rail.scale.set(this.a, this.b, 1);
    rail.position.y = 1.29;
    this.root.add(rail);
    const count = this.compact ? 32 : 64;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const alpha = Math.pow(1 - i / count, 2);
      colors.set([.3 * alpha, .95 * alpha, .77 * alpha], i * 3);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trail = new THREE.Points(geometry, new THREE.PointsMaterial({size:.065, vertexColors:true, transparent:true, opacity:.9, depthWrite:false, toneMapped:false, blending:THREE.AdditiveBlending}));
    this.trail.frustumCulled = false;
    this.root.add(this.trail);
    this.halo = new THREE.Mesh(new THREE.RingGeometry(.66, .73, 48), material(0xf5cc80, .65));
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.visible = false;
    this.root.add(this.halo);
  }

  clear() {
    this.effects.forEach(effect => this.disposeObject(effect.mesh));
    this.effects = [];
  }

  pulse(position, color = 0x7efadd, scale = 1) {
    if (!this.enabled || document.hidden) return;
    while (this.effects.length >= 8) this.disposeObject(this.effects.shift().mesh);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(.25, .28, 48), new THREE.MeshBasicMaterial({color, transparent:true, opacity:.8, side:THREE.DoubleSide, depthWrite:false, toneMapped:false, blending:THREE.AdditiveBlending}));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position); mesh.position.y = Math.max(1.415, position.y);
    this.root.add(mesh);
    this.effects.push({mesh, start:performance.now(), duration:950, scale});
  }

  update(now, seat, enabled) {
    this.enabled = enabled;
    // The steady rail stays visible when decorative motion is switched off.
    this.trail.visible = enabled;
    this.halo.visible = !!seat;
    if (seat) {
      this.halo.position.copy(seat.a.seat).setY(.025);
      this.halo.material.opacity = enabled ? .48 + Math.sin(now / 650) * .2 : .5;
      this.halo.scale.setScalar(enabled ? 1 + Math.sin(now / 650) * .045 : 1);
    }
    if (!enabled) { this.clear(); return; }
    const attribute = this.trail.geometry.attributes.position;
    for (let i = 0; i < attribute.count; i++) {
      const angle = now / 2600 - i / attribute.count * 1.6;
      attribute.setXYZ(i, Math.cos(angle) * this.a, 1.29, Math.sin(angle) * this.b);
    }
    attribute.needsUpdate = true;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i], p = (now - effect.start) / effect.duration;
      if (p >= 1) { this.disposeObject(effect.mesh); this.effects.splice(i, 1); continue; }
      effect.mesh.scale.setScalar(1 + p * 5 * effect.scale);
      effect.mesh.material.opacity = .75 * (1 - p) ** 2;
    }
  }
}
