import React from 'react';
import classNames from 'classnames';
import { useDispatch, useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';

import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { createResourceLocatorString } from '../../util/routes';
import {
  toggleCart,
  selectCartCountForListing,
  selectIsToggleCartInProgress,
} from '../../ducks/cart.duck';

import { SecondaryButton, IconCart } from '../../components';

import css from './AddToCartButton.module.css';

/**
 * An add-to-cart control for a product listing. Shows a plain "Add to cart"
 * button when the listing isn't in the cart yet, and a quantity stepper
 * (- count +) once it is.
 *
 * @component
 * @param {Object} props
 * @param {Object} props.listing - API entity: the listing that would be transacted
 *   (for products with variants, this must be the resolved variant sibling, not
 *   the primary listing - it's the sibling's id that is stored in the cart).
 * @param {number?} props.currentStock - current stock of the listing; caps the stepper
 * @param {number?} props.quantity - how many units the first click adds (e.g. the order
 *   form's selected "Number of items"); the stepper takes over once the item is in the cart
 * @param {boolean?} props.disabled - true while a required selection (e.g. size/color)
 *   is incomplete; renders a disabled button with a hint instead of the normal control
 * @param {string?} props.className add more style rules in addition to component's own css.root
 * @param {string?} props.rootClassName overwrite component's own css.root
 * @returns {JSX.Element}
 */
const AddToCartButton = props => {
  const { listing, currentStock, quantity = 1, disabled, className, rootClassName } = props;
  const dispatch = useDispatch();
  const history = useHistory();
  const location = useLocation();
  const routeConfiguration = useRouteConfiguration();
  const intl = useIntl();

  const currentUser = useSelector(state => state.user.currentUser);
  const listingId = listing?.id?.uuid;
  const authorId = listing?.author?.id?.uuid;
  const count = useSelector(state => selectCartCountForListing(state, listingId));
  const inProgress = useSelector(state => selectIsToggleCartInProgress(state, listingId));

  const classes = classNames(rootClassName || css.root, className);

  if (disabled) {
    return (
      <div className={classes}>
        <SecondaryButton className={css.addButton} disabled>
          <IconCart className={css.buttonIcon} />
          <FormattedMessage id="AddToCartButton.addToCart" />
        </SecondaryButton>
        <p className={css.hint}>
          <FormattedMessage id="AddToCartButton.selectVariantFirst" />
        </p>
      </div>
    );
  }

  const handleToggle = increment => {
    if (!listingId || !authorId || inProgress) {
      return;
    }

    if (!currentUser) {
      const state = { from: `${location.pathname}${location.search}${location.hash}` };
      history.push(createResourceLocatorString('SignupPage', routeConfiguration, {}, {}), state);
      return;
    }

    dispatch(toggleCart(listingId, authorId, increment));
  };

  const isMaxItems = typeof currentStock === 'number' && count >= currentStock;

  // The first click adds the whole selected quantity (clamped to stock); after that the
  // stepper adjusts one unit at a time.
  const sanitizedQuantity = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const initialAddQuantity =
    typeof currentStock === 'number' ? Math.min(sanitizedQuantity, currentStock) : sanitizedQuantity;

  if (count === 0) {
    return (
      <div className={classes}>
        <SecondaryButton
          className={css.addButton}
          type="button"
          inProgress={inProgress}
          onClick={() => handleToggle(initialAddQuantity)}
        >
          <IconCart className={css.buttonIcon} />
          <FormattedMessage id="AddToCartButton.addToCart" />
        </SecondaryButton>
      </div>
    );
  }

  return (
    <div className={classes}>
      <div className={css.stepper}>
        <button
          type="button"
          className={css.stepperButton}
          onClick={() => handleToggle(-1)}
          disabled={inProgress}
          aria-label={intl.formatMessage({ id: 'AddToCartButton.decreaseQuantity' })}
        >
          −
        </button>
        <span className={css.count}>{count}</span>
        <button
          type="button"
          className={css.stepperButton}
          onClick={() => handleToggle(1)}
          disabled={inProgress || isMaxItems}
          aria-label={intl.formatMessage({ id: 'AddToCartButton.increaseQuantity' })}
        >
          +
        </button>
      </div>
      <p className={css.inCartLabel}>
        <FormattedMessage id="AddToCartButton.inCart" />
      </p>
    </div>
  );
};

export default AddToCartButton;
