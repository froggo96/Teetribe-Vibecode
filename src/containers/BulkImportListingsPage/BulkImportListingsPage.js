import React, { useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { useConfiguration } from '../../context/configurationContext';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, Page, LayoutSingleColumn, PrimaryButton, SecondaryButton, IconSpinner } from '../../components';
import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import { parseAndValidateFileThunk, runImportThunk, clearImport } from './BulkImportListingsPage.duck';
import css from './BulkImportListingsPage.module.css';

const STATUS_LABEL_IDS = {
  invalid: 'BulkImportListingsPage.statusInvalid',
  ready: 'BulkImportListingsPage.statusReady',
  importing: 'BulkImportListingsPage.statusImporting',
  done: 'BulkImportListingsPage.statusDone',
  error: 'BulkImportListingsPage.statusError',
};

const SETTLED_STATUSES = ['done', 'error', 'invalid'];

/**
 * The BulkImportListingsPage component: upload a CSV describing one or more products (including
 * this marketplace's size/color variant combinations), preview per-row validation errors, then
 * import everything that validates. See src/util/csvImportParsing.js for the CSV schema and
 * src/containers/BulkImportListingsPage/BulkImportListingsPage.duck.js for the import mechanics.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled
 * @param {boolean} props.parseInProgress
 * @param {Object} [props.parseError]
 * @param {Array} props.groups - one entry per product group: {groupKey, rowCount, errors, plan, status, importError?, resultListingIds?}
 * @param {boolean} props.importInProgress
 * @param {Function} props.onParseFile
 * @param {Function} props.onRunImport
 * @param {Function} props.onClearImport
 * @returns {JSX.Element}
 */
export const BulkImportListingsPageComponent = props => {
  const intl = useIntl();
  const config = useConfiguration();
  const [fileName, setFileName] = useState(null);

  const {
    scrollingDisabled,
    parseInProgress,
    parseError,
    groups,
    importInProgress,
    onParseFile,
    onRunImport,
    onClearImport,
  } = props;

  const handleFileChange = e => {
    const file = e.target.files && e.target.files[0];
    // Reset the input so choosing the same file again still fires onChange.
    e.target.value = '';
    if (!file) {
      return;
    }
    setFileName(file.name);
    onClearImport();
    onParseFile(file, config);
  };

  const readyGroups = groups.filter(g => g.status === 'ready');
  const failedGroups = groups.filter(g => g.status === 'error');
  const hasGroups = groups.length > 0;
  const doneCount = groups.filter(g => g.status === 'done').length;
  const allSettled = hasGroups && groups.every(g => SETTLED_STATUSES.includes(g.status));

  return (
    <Page
      title={intl.formatMessage({ id: 'BulkImportListingsPage.title' })}
      scrollingDisabled={scrollingDisabled}
    >
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.root}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="BulkImportListingsPage.heading" />
          </H3>
          <p className={css.description}>
            <FormattedMessage id="BulkImportListingsPage.description" />
          </p>

          <label className={css.uploadLabel} htmlFor="bulkImportCsvInput">
            <FormattedMessage id="BulkImportListingsPage.chooseFile" />
          </label>
          <input
            id="bulkImportCsvInput"
            className={css.fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={parseInProgress || importInProgress}
          />
          {fileName ? <span className={css.fileName}>{fileName}</span> : null}
          {parseInProgress ? <IconSpinner className={css.spinner} /> : null}

          {parseError ? (
            <p className={css.error}>
              <FormattedMessage
                id="BulkImportListingsPage.parseError"
                values={{ message: parseError.message }}
              />
            </p>
          ) : null}

          {hasGroups ? (
            <div className={css.tableWrapper}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th><FormattedMessage id="BulkImportListingsPage.columnProduct" /></th>
                    <th><FormattedMessage id="BulkImportListingsPage.columnRows" /></th>
                    <th><FormattedMessage id="BulkImportListingsPage.columnStatus" /></th>
                    <th><FormattedMessage id="BulkImportListingsPage.columnDetails" /></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(group => (
                    <tr key={group.groupKey}>
                      <td>{(group.plan && group.plan.title) || group.groupKey}</td>
                      <td>{group.rowCount}</td>
                      <td className={css[`status_${group.status}`]}>
                        <FormattedMessage id={STATUS_LABEL_IDS[group.status]} />
                      </td>
                      <td>
                        {group.errors.map((e, i) => (
                          <div key={i} className={css.error}>
                            <FormattedMessage
                              id="BulkImportListingsPage.rowError"
                              values={{ row: e.rowNumber, field: e.field, message: e.message }}
                            />
                          </div>
                        ))}
                        {group.importError ? (
                          <div className={css.error}>
                            {group.importError.apiErrors && group.importError.apiErrors.length > 0
                              ? group.importError.apiErrors
                                  .map(e => e.detail || e.title)
                                  .join('; ')
                              : group.importError.message}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {hasGroups ? (
            <div className={css.actions}>
              <PrimaryButton
                className={css.importButton}
                disabled={importInProgress || readyGroups.length === 0}
                inProgress={importInProgress}
                onClick={() => onRunImport(readyGroups)}
              >
                <FormattedMessage
                  id="BulkImportListingsPage.importButton"
                  values={{ count: readyGroups.length }}
                />
              </PrimaryButton>
              {failedGroups.length > 0 && !importInProgress ? (
                <SecondaryButton
                  className={css.retryButton}
                  onClick={() => onRunImport(failedGroups)}
                >
                  <FormattedMessage
                    id="BulkImportListingsPage.retryFailed"
                    values={{ count: failedGroups.length }}
                  />
                </SecondaryButton>
              ) : null}
            </div>
          ) : null}

          {allSettled ? (
            <p className={css.summary}>
              <FormattedMessage
                id="BulkImportListingsPage.summary"
                values={{ done: doneCount, total: groups.length }}
              />
            </p>
          ) : null}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { parseInProgress, parseError, groups, importInProgress } = state.BulkImportListingsPage;
  return {
    scrollingDisabled: isScrollingDisabled(state),
    parseInProgress,
    parseError,
    groups,
    importInProgress,
  };
};

const mapDispatchToProps = dispatch => ({
  onParseFile: (file, config) => dispatch(parseAndValidateFileThunk({ file, config })),
  onRunImport: groupsToImport => dispatch(runImportThunk({ groups: groupsToImport })),
  onClearImport: () => dispatch(clearImport()),
});

const BulkImportListingsPage = compose(connect(mapStateToProps, mapDispatchToProps))(
  BulkImportListingsPageComponent
);

export default BulkImportListingsPage;
