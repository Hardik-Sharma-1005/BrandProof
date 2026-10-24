document.addEventListener("DOMContentLoaded", () => {
  const revealItems = document.querySelectorAll("[data-scroll-reveal]");
  if (!revealItems.length) return;

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -20px 0px" });

  revealItems.forEach((item) => revealObserver.observe(item));
});
