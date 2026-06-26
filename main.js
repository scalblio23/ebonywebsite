// Sound toggle
function toggleSound() {
  const vid = document.getElementById('hero-vid');
  const btn = document.querySelector('.sound-btn');
  if (!vid) return;
  vid.muted = !vid.muted;
  btn.textContent = vid.muted ? '🔇 Enable sound' : '🔊 Sound on';
}

// Carousel
(function () {
  const track = document.getElementById('carousel-track');
  const dotsContainer = document.getElementById('carousel-dots');
  if (!track) return;

  const slides = track.querySelectorAll('.carousel-slide');
  const total = slides.length;
  let current = 0;

  // Build dots
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
    dot.addEventListener('click', () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  function goTo(index) {
    current = (index + total) % total;
    track.style.transform = `translateX(-${current * 100}%)`;
    dotsContainer.querySelectorAll('.carousel-dot').forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });
  }

  window.moveCarousel = function (dir) { goTo(current + dir); };

  // Auto-advance
  setInterval(() => goTo(current + 1), 4000);
})();
