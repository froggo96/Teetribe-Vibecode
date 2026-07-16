import React from 'react';
import classNames from 'classnames';

import css from './IconCart.module.css';

/**
 * Shopping cart icon, used for the add-to-cart button and the topbar cart link.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to components own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {string?} props.ariaLabel aria-label for svg image
 * @returns {JSX.Element} SVG icon
 */
const IconCart = props => {
  const { className, rootClassName, ariaLabel } = props;
  const classes = classNames(rootClassName || css.root, className);
  const ariaLabelMaybe = ariaLabel ? { ['aria-label']: ariaLabel } : {};

  return (
    <svg
      className={classes}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      {...ariaLabelMaybe}
    >
      <circle cx="9.5" cy="20.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="20.5" r="1.5" fill="currentColor" stroke="none" />
      <path
        d="M2 2.5h3l2.5 12a2 2 0 0 0 2 1.5h8.6a2 2 0 0 0 2-1.5L22 7H6"
        fill="none"
        strokeWidth="1.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default IconCart;
