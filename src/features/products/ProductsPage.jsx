import { Box, PackageSearch } from 'lucide-react';
import { PageHeader, PageMain } from '../../shared/ui/Page';
import './ProductsPage.css';

const ProductsPage = ({ onSelectEngagement, onSelectProduct, scopeProducts }) => {
  const totalEngagements = scopeProducts.reduce(
    (sum, p) => sum + (p.engagements?.length || 0), 0
  );
  const totalFindings = scopeProducts.reduce(
    (sum, p) => sum + (p.count || 0), 0
  );

  return (
    <>
      <PageHeader
        icon={PackageSearch}
        eyebrow="DefectDojo Scope"
        title="Products"
        description="Browse products and drill into engagement-level findings."
        metrics={[
          { label: 'Products', value: scopeProducts.length },
          { label: 'Engagements', value: totalEngagements },
          { label: 'Findings', value: totalFindings, tone: 'accent' },
        ]}
      />

      <PageMain className="products-main">
        {scopeProducts.length > 0 ? (
          <section className="products-card-grid" aria-label="Product list">
            {scopeProducts.map((product, idx) => (
              <article
                key={product.value}
                className="pcard products-card-enter"
                style={{ animationDelay: `${Math.min(idx * 50, 500)}ms` }}
              >
                <button
                  type="button"
                  className="pcard-header"
                  onClick={() => onSelectProduct(product)}
                >
                  <div className="pcard-icon">
                    <Box size={18} />
                  </div>
                  <div className="pcard-info">
                    <strong>{product.name}</strong>
                    <small>
                      {product.count} compacted finding{product.count !== 1 ? 's' : ''}
                      {product.engagements?.length > 0 && (
                        <> · {product.engagements.length} engagement{product.engagements.length !== 1 ? 's' : ''}</>
                      )}
                    </small>
                  </div>
                  <span className="pcard-count">{product.count}</span>
                </button>

                {product.engagements?.length > 0 && (
                  <div className="pcard-engagements">
                    {product.engagements.map(engagement => (
                      <button
                        key={`${product.value}-${engagement.value}`}
                        type="button"
                        className="pcard-engagement-row"
                        onClick={() => onSelectEngagement(product, engagement)}
                      >
                        <span className="pcard-engagement-dot" />
                        <span className="pcard-engagement-name">{engagement.name}</span>
                        <strong className="pcard-engagement-count">{engagement.count}</strong>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        ) : (
          <div className="products-empty" role="status">
            <div className="products-empty-icon-wrap">
              <span className="products-empty-pulse" />
              <PackageSearch size={44} />
            </div>
            <h2>No products found</h2>
            <p>Run a sync or pull data from DefectDojo to populate products.</p>
          </div>
        )}
      </PageMain>
    </>
  );
};

export default ProductsPage;
