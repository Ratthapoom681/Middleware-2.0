import './Page.css';

const joinClassNames = (...classes) => classes.filter(Boolean).join(' ');

export const PageMain = ({ children, className = '', narrow = false }) => (
  <main className={joinClassNames('main-content page-main', narrow && 'page-main-narrow', className)}>
    {children}
  </main>
);
