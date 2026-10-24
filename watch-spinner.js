class WatchSpinner extends HTMLElement {
  constructor() {
    super();
    this._label = null;
    this._state = "idle";
    this._render();
  }

  _render() {
    if (!this._label) {
      this._label = document.createElement("span");
      this._label.className = "sr-only";
      this._label.setAttribute("aria-live", "polite");
      this.appendChild(this._label);
    }
    this.setAttribute("data-state", this._state);
    this.setAttribute("aria-busy", this._state === "loading" ? "true" : "false");
    this._label.textContent = this._labelText || "";
  }

  setProps({ state = "idle", label = "" }) {
    this._state = state;
    this._labelText = label;
    this._render();
  }
}

if (!customElements.get("watch-spinner")) {
  customElements.define("watch-spinner", WatchSpinner);
}
