// src/test/e2e/mobile-comments-scroll.spec.ts
// Verifies the mobile comment table advertises touch scrolling to the browser.
import { expect, test } from '@playwright/test'

test.use( {
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
} )

test( 'allows horizontal panning when a touch gesture starts over comment content', async ( { page } ) => {
  await page.goto( '/' )
  const appCssUrl = new URL( '/src/App.css', page.url() ).toString()
  await page.setContent( `
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${appCssUrl}">
    <main class="app-shell">
      <article class="project-card">
        <div class="stack">
          <div class="data-table data-table--comments">
            <table>
              <colgroup><col><col><col><col></colgroup>
              <tbody>
                <tr>
                  <td>Reviewer</td>
                  <td><span class="comment-body-with-reactions"><span>Comment content</span></span></td>
                  <td>now</td>
                  <td><div class="comment-reaction-cell"><button>😊</button></div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </main>
  ` )

  const table = page.locator( '.data-table--comments' )
  await expect( table ).toBeVisible()

  const styleContract = await table.evaluate( ( element ) => {
    return {
      scrollWidthExceedsViewport: element.scrollWidth > element.clientWidth,
      touchAction: getComputedStyle( element ).touchAction,
    }
  } )

  expect( styleContract ).toEqual( {
    scrollWidthExceedsViewport: true,
    touchAction: 'pan-x pan-y',
  } )

  const commentBody = page.locator( '.comment-body-with-reactions' )
  const commentBox = await commentBody.boundingBox()
  if( !commentBox ) {
    throw new Error( 'Expected the comment body to have a visible touch target.' )
  }
  const client = await page.context().newCDPSession( page )
  const startX = commentBox.x + 10
  const startY = commentBox.y + 10
  await client.send( 'Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [ { x: startX, y: startY } ],
  } )
  for( let index = 1; index <= 12; index += 1 ) {
    await client.send( 'Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [ { x: startX - index * 12, y: startY } ],
    } )
  }
  await client.send( 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] } )

  await expect.poll( () => table.evaluate( ( element ) => element.scrollLeft ) ).toBeGreaterThan( 0 )
} )

test( 'does not chain a second comment drag into the outer issue table', async ( { page } ) => {
  await page.goto( '/' )
  const appCssUrl = new URL( '/src/App.css', page.url() ).toString()
  await page.setContent( `
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${appCssUrl}">
    <main class="app-shell">
      <div class="data-table data-table--threads">
        <table>
          <tbody>
            <tr><td>Issue</td><td>Status</td><td>Author</td><td>Comments</td><td>Action</td></tr>
            <tr class="data-table-row--expanded">
              <td colspan="5">
                <div class="issue-conversation-expanded">
                  <div class="stack">
                    <div class="data-table data-table--comments">
                      <table>
                        <colgroup><col><col><col><col></colgroup>
                        <tbody>
                          <tr>
                            <td>Reviewer</td>
                            <td><span class="comment-body-with-reactions"><span>Comment content</span></span></td>
                            <td>now</td>
                            <td><div class="comment-reaction-cell"><button>😊</button></div></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  ` )

  const innerTable = page.locator( '.data-table--comments' )
  const outerTable = page.locator( '.data-table--threads' )
  const commentBody = page.locator( '.comment-body-with-reactions' )
  const commentBox = await commentBody.boundingBox()
  if( !commentBox ) {
    throw new Error( 'Expected the nested comment body to have a visible touch target.' )
  }
  const client = await page.context().newCDPSession( page )
  const swipeFromComment = async () => {
    const startX = commentBox.x + 10
    const startY = commentBox.y + 10
    await client.send( 'Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [ { x: startX, y: startY } ],
    } )
    for( let index = 1; index <= 12; index += 1 ) {
      await client.send( 'Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [ { x: startX - index * 12, y: startY } ],
      } )
    }
    await client.send( 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] } )
  }

  await swipeFromComment()
  await expect.poll( () => innerTable.evaluate( ( element ) => element.scrollLeft ) ).toBeGreaterThan( 0 )
  await expect( outerTable ).toHaveJSProperty( 'scrollLeft', 0 )

  await swipeFromComment()
  await expect( outerTable ).toHaveJSProperty( 'scrollLeft', 0 )
} )
