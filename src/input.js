// Click-to-select / click-to-move controller. Only the side to move is selectable.
// Movement requests go through game.makeMove; promotion is resolved via onPromotion.
export class Input {
  constructor(scene, game, { onPromotion }) {
    this.scene = scene;
    this.game = game;
    this.onPromotion = onPromotion;
    this.enabled = false;
    this.selected = null;
    this.targets = [];
    this._busy = false; // true while a move (incl. its async promotion) is committing
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this._clear(); }

  async onSquarePicked(square) {
    if (!this.enabled || this._busy) return;

    if (this.selected === null) {
      this._trySelect(square);
      return;
    }

    if (this.targets.includes(square)) {
      const from = this.selected;
      const to = square;
      const color = this.game.pieceAt(from)?.color;
      const needsPromo = this.game.isPromotion(from, to);
      this._clear();
      this._busy = true;
      try {
        const promotion = needsPromo ? await this.onPromotion(color) : undefined;
        this.game.makeMove({ from, to, promotion });
      } finally {
        this._busy = false;
      }
      return;
    }

    const piece = this.game.pieceAt(square);
    if (piece && piece.color === this.game.turn()) {
      this._trySelect(square);
      return;
    }
    this._clear();
  }

  _trySelect(square) {
    const piece = this.game.pieceAt(square);
    if (!piece || piece.color !== this.game.turn()) return;
    this.selected = square;
    this.targets = this.game.legalTargets(square);
    this.scene.setHighlights(this.targets);
  }

  _clear() {
    this.selected = null;
    this.targets = [];
    this.scene.clearHighlights();
  }
}
