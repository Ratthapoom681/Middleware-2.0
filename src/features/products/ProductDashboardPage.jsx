import { ArrowLeft, Layers, PackageSearch, ShieldAlert } from 'lucide-react';
import SummaryCards from '../dashboard/component/SummaryCards';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import './ProductDashboardPage.css';

const ProductDashboardPage = ({
  engagements,
  onBackToProducts,
  onViewEngagementFindings,
  onViewFindings,
  product,
  severityCounts,
  severityOptions,
  summary,
}) => {
  if (!product) {
    return (
      <>
        <PageHeader
          icon={PackageSearch}
          eyebrow="Product Dashboard"
          title="Product not found"
        />
        <PageMain className="pd-main">
          <div className="products-empty" role="status">
            <div className="products-empty-icon-wrap">
              <span className="products-empty-pulse" />
              <PackageSearch size={44} />
            </div>
            <h2>Product not found</h2>
            <p>Select a product from the Products page to open its dashboard.</p>
            <button type="button" className="btn-secondary" onClick={onBackToProducts} style={{ marginTop: '1rem' }}>
              <ArrowLeft size={14} /> Back to Products
            </button>
          </div>
        </PageMain>
      </>
    );
  }

  const compactedCount = product.count || 0;
  const engagementCount = engagements.length;

  return (
    <>
      <PageHeader
        icon={PackageSearch}
        eyebrow="Product Dashboard"
        title={product.name}
        description={`${compactedCount} compacted finding${compactedCount !== 1 ? 's' : ''} - ${engagementCount} engagement${engagementCount !== 1 ? 's' : ''}`}
        actions={(
          <>
            <button type="button" className="btn-secondary" onClick={onBackToProducts}>
              <ArrowLeft size={14} />
              Products
            </button>
            <button type="button" className="btn-primary" onClick={onViewFindings}>
              <ShieldAlert size={14} />
              View Findings
            </button>
          </>
        )}
      />

      <PageMain className="pd-main">
        <SummaryCards summary={summary} />

        <section className="pd-section" aria-labelledby="pd-severity-title">
          <div className="pd-section-header">
            <div>
              <p className="eyebrow">Compacted Severity</p>
              <h2 id="pd-severity-title">Severity mix</h2>
            </div>
          </div>
          <div className="pd-severity-grid" aria-label={`${product.name} severity summary`}>
            {severityOptions.map(severity => {
              const count = severityCounts[severity] || 0;
              return (
                <div key={severity} className={`pd-severity-card ${severity.toLowerCase()}`}>
                  <span className="pd-severity-accent" />
                  <strong className="pd-severity-value">{count}</strong>
                  <span className="pd-severity-label">{severity}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="pd-section" aria-labelledby="pd-engagements-title">
          <div className="pd-section-header">
            <div>
              <p className="eyebrow">DefectDojo Engagements</p>
              <h2 id="pd-engagements-title">Engagement drilldown</h2>
            </div>
            <span className="pd-section-count">
              <Layers size={14} />
              {engagementCount} engagement{engagementCount !== 1 ? 's' : ''}
            </span>
          </div>

          {engagements.length > 0 ? (
            <div className="pd-engagement-grid">
              {engagements.map((engagement, idx) => (
                <button
                  key={engagement.value}
                  type="button"
                  className="pd-engagement-card products-card-enter"
                  style={{ animationDelay: `${Math.min(idx * 50, 400)}ms` }}
                  onClick={() => onViewEngagementFindings(engagement)}
                >
                  <span className="pd-engagement-main">
                    <strong>{engagement.name}</strong>
                    <small>{engagement.count} compacted finding{engagement.count !== 1 ? 's' : ''}</small>
                  </span>
                  <span className="pd-engagement-severity" aria-label={`${engagement.name} severity counts`}>
                    {severityOptions.map(severity => {
                      const count = engagement.severityCounts?.[severity] || 0;
                      if (count === 0 && severity !== 'All') return null;
                      return (
                        <span key={severity} className={`mini-severity ${severity.toLowerCase()}`}>
                          {severity[0]} {count}
                        </span>
                      );
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="products-empty compact" role="status">
              <div className="products-empty-icon-wrap">
                <PackageSearch size={38} />
              </div>
              <h2>No engagements found</h2>
              <p>This product has no engagement breakdown in the current data.</p>
            </div>
          )}
        </section>
      </PageMain>
    </>
  );
};

export default ProductDashboardPage;
