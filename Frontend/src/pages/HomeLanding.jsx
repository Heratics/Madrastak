import { useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap, PenLine, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PRODUCTS = {
  madrastak: {
    id: 'madrastak',
    name: 'Madrastak',
    eyebrow: 'School & learning platform',
    description: 'Your school. Your classroom. Your learning.',
    detail: 'A connected place for students, teachers, classes, and live learning.',
    icon: GraduationCap,
    accent: 'madrastak',
  },
  alamatak: {
    id: 'alamatak',
    name: '3alamatak',
    eyebrow: 'Teacher markbook platform',
    description: 'Your marks. Your classes. Your progress.',
    detail: 'A focused workspace for assessments, grades, and academic records.',
    icon: PenLine,
    accent: 'alamatak',
  },
};

export default function HomeLanding() {
  const navigate = useNavigate();
  const [activeProduct, setActiveProduct] = useState(null);
  const [showComingSoon, setShowComingSoon] = useState(false);

  const enterMadrastak = () => {
    navigate('/home');
  };

  const openAlamatak = () => {
    setShowComingSoon(true);
  };

  return (
    <main className="landing-shell">
      <div className="landing-header">
        <a className="landing-brand" href="/" aria-label="Manastak home">
          <span className="landing-brand-mark"><GraduationCap size={20} strokeWidth={2.4} /></span>
          <span>Manastak</span>
        </a>
        <p className="landing-kicker">One ecosystem for every learning journey</p>
      </div>

      <section
        className={`product-panels ${activeProduct ? `is-${activeProduct}` : ''}`}
        aria-label="Choose a Manastak product"
        onMouseLeave={() => setActiveProduct(null)}
      >
        <ProductPanel
          product={PRODUCTS.madrastak}
          isActive={activeProduct === PRODUCTS.madrastak.id}
          onActivate={() => setActiveProduct(PRODUCTS.madrastak.id)}
          onEnter={enterMadrastak}
        />
        <ProductPanel
          product={PRODUCTS.alamatak}
          isActive={activeProduct === PRODUCTS.alamatak.id}
          onActivate={() => setActiveProduct(PRODUCTS.alamatak.id)}
          onEnter={openAlamatak}
        />
      </section>

      <footer className="landing-footer">
        <span>Built for schools, teachers, and students.</span>
        <span className="landing-footer-dot" aria-hidden="true" />
        <span>© 2026 Manastak</span>
      </footer>

      {showComingSoon && (
        <div className="coming-soon-backdrop" role="presentation" onMouseDown={() => setShowComingSoon(false)}>
          <section
            className="coming-soon-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coming-soon-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="dialog-close"
              aria-label="Close dialog"
              onClick={() => setShowComingSoon(false)}
            >
              <X size={18} />
            </button>
            <div className="dialog-icon"><PenLine size={23} /></div>
            <p className="dialog-eyebrow">Coming soon</p>
            <h2 id="coming-soon-title">3alamatak is on its way.</h2>
            <p>We are preparing the teacher markbook experience as part of the Manastak ecosystem.</p>
            <button type="button" className="dialog-action" onClick={() => setShowComingSoon(false)}>
              Back to products
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

function ProductPanel({ product, isActive, onActivate, onEnter }) {
  const Icon = product.icon;

  return (
    <article
      className={`product-panel product-panel-${product.accent} ${isActive ? 'is-active' : ''}`}
      onMouseEnter={onActivate}
    >
      <div className="panel-grid" aria-hidden="true" />
      <div className="panel-content">
        <div className="panel-topline">
          <span className="panel-icon"><Icon size={24} strokeWidth={2.1} /></span>
          <span className="panel-index">0{product.id === 'madrastak' ? '1' : '2'}</span>
        </div>
        <div className="panel-copy">
          <p className="panel-eyebrow">{product.eyebrow}</p>
          <h1>{product.name}</h1>
          <p className="panel-description">{product.description}</p>
          <p className="panel-detail">{product.detail}</p>
        </div>
        <button type="button" className="panel-cta" onClick={onEnter}>
          <span>Enter {product.name}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="panel-footer" aria-hidden="true">
        {product.id === 'madrastak' ? <><BookOpen size={15} /> Learn together</> : <><PenLine size={15} /> Keep every mark in view</>}
      </div>
    </article>
  );
}
