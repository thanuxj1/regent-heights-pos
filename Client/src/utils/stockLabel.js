/**
 * How a menu item's stock reads on a screen.
 *
 * A property sells three kinds of thing, and only two of them have a number:
 *
 *   counted        a tray of pastries, a crate of water — twenty go on the
 *                  rack, and the count goes down as they sell;
 *   from a recipe  what the ingredients allow, worked out by the server;
 *   made to order  kottu, a fried rice — the kitchen makes one when somebody
 *                  asks. Nobody can say in the morning how many the property
 *                  "has", so nothing is counted and nothing runs out.
 *
 * The server says which by `stock_mode`, and sends `available: null` for the
 * last of them. Every screen showing a product tile asks this so the till, the
 * waiter's pad and the room rack never disagree about whether something is
 * sold out.
 *
 * When something counts as "low" is the owner's decision, not the screen's:
 * `low_stock` comes from the product page's own Low stock alert. Ten is only
 * what an item gets when nobody has said otherwise. Before this the list called
 * ten low and the till called five low, and the field on the form changed
 * neither.
 */
const DEFAULT_LOW_AT = 10;

export function stockOf(product) {
  const lowAt = Number(product?.low_stock) > 0 ? Number(product.low_stock) : DEFAULT_LOW_AT;

  if (product?.stock_mode === "made_to_order") {
    return { madeToOrder: true, count: null, soldOut: false, low: false, lowAt, label: "Made to order" };
  }
  const count = Number(product?.available ?? product?.pro_quantity ?? 0);
  const soldOut = count <= 0;
  return {
    madeToOrder: false,
    count,
    soldOut,
    low: count > 0 && count <= lowAt,
    lowAt,
    label: soldOut ? "0 in stock" : `${count} left`,
  };
}

export default stockOf;
