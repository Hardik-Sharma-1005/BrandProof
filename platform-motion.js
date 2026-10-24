document.documentElement.classList.add('js');
document.addEventListener('DOMContentLoaded', () => {
  const revealTargets = document.querySelectorAll('[data-scroll-reveal]');
  if (typeof window.IntersectionObserver !== 'function' || revealTargets.length === 0) {
    revealTargets.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.14,
    rootMargin: '0px 0px -18px 0px'
  });

  revealTargets.forEach((element) => observer.observe(element));
});
