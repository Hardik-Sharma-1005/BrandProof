(() => {
  const DEFAULT_LABELS = {
    idle: "",
    loading: "Checking this draft against the current brand rules and sources...",
    complete: "Review complete. Findings are ready.",
    error: "The review could not be completed. Check the error details and try again.",
  };

  const cells = Array.from({ length: 9 }, (_, index) => {
    const center = index === 4 ? " depth-orbs__cell--center" : "";
    return `<span class="depth-orbs__cell${center}" aria-hidden="true"></span>`;
  }).join("");

  class DepthOrbs extends HTMLElement {
    static get observedAttributes() {
      return ["state", "label"];
    }

    connectedCallback() {
      if (!this.querySelector(".depth-orbs__inner")) {
        this.innerHTML = `<span class="depth-orbs__inner"><span class="depth-orbs__visual" aria-hidden="true">${cells}</span><span class="depth-orbs__label"></span></span>`;
      }
      this.setAttribute("role", "status");
      this.setAttribute("aria-live", "polite");
      this.setAttribute("aria-atomic", "true");
      this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    setProps({ state = this.getAttribute("state") || "idle", label } = {}) {
      this.setAttribute("state", state);
      if (label !== undefined) this.setAttribute("label", label);
    }

    render() {
      const state = ["idle", "loading", "complete", "error"].includes(this.getAttribute("state"))
        ? this.getAttribute("state")
        : "idle";
      const label = this.getAttribute("label") || DEFAULT_LABELS[state];
      const labelNode = this.querySelector(".depth-orbs__label");

      this.dataset.state = state;
      this.hidden = state === "idle";
      this.setAttribute("aria-busy", state === "loading" ? "true" : "false");
      if (labelNode && labelNode.textContent !== label) labelNode.textContent = label;
    }
  }

  if (!customElements.get("depth-orbs")) customElements.define("depth-orbs", DepthOrbs);
})();
