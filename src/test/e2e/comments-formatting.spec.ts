// src/test/e2e/comments-formatting.spec.ts: Verifies real comment columns preserve paragraphs in a browser.
import { expect, test } from '@playwright/test'

test( 'comment table preserves CRLF paragraphs and literal text with reactions', async ( { page } ) => {
  await page.goto( '/' )
  await page.setContent( '<link rel="stylesheet" href="/src/App.css"><div id="comments-test"></div>' )
  await page.addScriptTag( { type: 'module', content: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import DataTable from '/src/components/DataTable.tsx';
    import { useCommentColumns } from '/src/pages/versions/columns.tsx';
    function Comments() {
      const columns = useCommentColumns( {
        formatUserLabel: ( id ) => id,
        commentReactionsByCommentId: {
          c1: { counts: { good: 1, regular: 0, bad: 0 }, currentUserReaction: null },
        },
        pendingCommentReactionIds: {}, onSetCommentReaction: () => {},
      } );
      return React.createElement( DataTable, {
        columns, data: [ {
          id: 'c1', threadId: 't1', createdBy: 'Reviewer',
          body: 'First line\\r\\n\\r\\nSecond <strong>paragraph</strong>\\nThird line',
        } ], sorting: [], onSortingChange: () => {}, tableClassName: 'data-table--comments',
      } );
    }
    ReactDOM.createRoot( document.getElementById( 'comments-test' ) ).render( React.createElement( Comments ) );
  ` } )
  const body = page.locator( '.comment-body-with-reactions > span' ).first()
  await expect( body ).toBeVisible()
  await expect( body ).toHaveCSS( 'white-space', 'pre-wrap' )
  await expect( body.locator( 'strong' ) ).toHaveCount( 0 )
  const lines = await body.evaluate( ( element ) => {
    const text = element.firstChild!
    return [ 'First', 'Second', 'Third' ].map( ( word ) => {
      const range = document.createRange()
      const offset = text.textContent!.indexOf( word )
      range.setStart( text, offset )
      range.setEnd( text, offset + word.length )
      return range.getBoundingClientRect().top
    } )
  } )
  expect( lines.length ).toBeGreaterThanOrEqual( 3 )
  expect( lines[1] - lines[0] ).toBeGreaterThan( lines[2] - lines[1] )
  await expect( page.locator( '[data-comment-reaction-kind="good"]' ) ).toHaveText( '😊' )
} )
