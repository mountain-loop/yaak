import { type DecorationSet, MatchDecorator, type ViewUpdate } from '@codemirror/view';

/**
 * This is a custom MatchDecorator that will not decorate a match if the selection is inside it
 */
export class BetterMatchDecorator extends MatchDecorator {
  updateDeco(update: ViewUpdate, deco: DecorationSet): DecorationSet {
    if (!update.startState.selection.eq(update.state.selection)) {
      return super.createDeco(update.view);
    }
    return super.updateDeco(update, deco);
  }
}
