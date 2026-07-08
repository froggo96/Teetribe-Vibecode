import React from 'react';
import classNames from 'classnames';

import css from './IconHeart.module.css';

/**
 * Heart icon, used for the favorite/save-listing toggle.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to components own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {boolean?} props.isFilled is filled with color (i.e. listing is favorited)
 * @param {string} props.ariaLabel aria-label for svg image
 * @returns {JSX.Element} SVG icon
 */
const IconHeart = props => {
  const { className, rootClassName, isFilled, ariaLabel } = props;
  const filledOrDefault = isFilled ? css.filled : css.root;
  const classes = classNames(rootClassName || filledOrDefault, className);
  const ariaLabelMaybe = ariaLabel ? { ['aria-label']: ariaLabel } : {};

  return (
    <svg
      className={classes}
      width="20"
      height="18"
      viewBox="0 0 20 18"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      {...ariaLabelMaybe}
    >
      <path
        d="M10 17.25l-1.318-1.174C3.4 11.5.5 8.9.5 5.688.5 3.087 2.545 1 5.1 1c1.44 0 2.822.65 3.9 1.827C10.078 1.65 11.46 1 12.9 1c2.555 0 4.6 2.087 4.6 4.688 0 3.212-2.9 5.812-8.182 10.388L10 17.25z"
        fillRule="evenodd"
        strokeWidth="1.4"
        stroke="currentColor"
      />
    </svg>
  );
};

export default IconHeart;
