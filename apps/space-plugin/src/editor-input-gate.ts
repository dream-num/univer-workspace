/** Owned by one CollaborativeEditor. Neither status updates nor a projection
 * may release the other reason for suspending the SDK input surface. */
export class EditorInputGate {
  private connectionBlocked = false;
  private projectionBlocked = false;
  constructor(private readonly element: Pick<HTMLElement, 'inert'>) {}
  setConnectionBlocked(blocked: boolean) {
    this.connectionBlocked = blocked;
    this.apply();
  }
  setProjectionBlocked(blocked: boolean) {
    this.projectionBlocked = blocked;
    this.apply();
  }
  private apply() {
    this.element.inert = this.connectionBlocked || this.projectionBlocked;
  }
}
