interface ListItem {}

interface Page<T extends ListItem> {
    startPosition: number;
    numTotalItems: number;
    items: T[];
}

type RequestPage<T extends ListItem> = (
    startPosition: number,
    numberItems: number
) => Promise<Page<T>>;

type InsertRow<T extends ListItem> = (item: T) => HTMLElement;

let MIN_TRACKER_HEIGHT = 30;

class VerticalScrollController<T extends ListItem> {
    private previousPage: Page<T> | undefined;
    private currentPage: Page<T> | undefined;
    private nextPage: Page<T> | undefined;

    private numVisibleItems: number = 0;

    private requestPage: RequestPage<T> | undefined;
    private insertRow: InsertRow<T> | undefined;

    private content: HTMLElement | undefined;
    private tracker: HTMLElement | undefined;

    private trackerY = 0;
    private extrapolateFactor = 0;
    private trackableHeight = 0;
    private lastMargin = 0;
    private overlappingElements = 10;

    private rowHeight: number = 0;
    private startPosition = 0;
    private numTotalItems = 0;

    #onTrackerDownLambda = (evt: PointerEvent) => this.onTrackerDown(evt);
    #onTrackerUpLambda = (evt: PointerEvent) => this.onTrackerUp(evt);
    #onTrackerMoveLambda = (evt: PointerEvent) => this.onTrackerMove(evt);
    #onScrollWheel = (evt: WheelEvent) => this.onScrollWheel(evt);

    constructor(private scrollable: HTMLElement, scrollbar: HTMLElement) {
        this.content = scrollable.firstElementChild as HTMLElement;
        this.tracker = scrollbar.firstElementChild as HTMLElement;

        this.tracker.addEventListener("pointerdown", this.#onTrackerDownLambda);
        this.scrollable.addEventListener("wheel", this.#onScrollWheel);
        this.tracker.style.marginTop = `0px`;
    }

    public async initialize(
        getPage: RequestPage<T>,
        insertRow: InsertRow<T>,
        dummyEntry: T
    ) {
        this.requestPage = getPage;
        this.insertRow = insertRow;
        // get element height
        let availableHeight = this.scrollable.clientHeight;
        // calculate number of elements that can be fully rendered
        this.rowHeight = await this.calculateEntryHeight(dummyEntry);
        this.numVisibleItems = Math.ceil(availableHeight / this.rowHeight);

        // get the page and the next page
        this.updatePages(0, 0);
    }

    protected onTrackerDown(evt: PointerEvent) {
        this.trackerY = evt.pageY;
        this.lastMargin = parseFloat(this.tracker!.style.marginTop);
        window.addEventListener("pointerup", this.#onTrackerUpLambda);
        window.addEventListener("pointermove", this.#onTrackerMoveLambda);
    }

    protected onTrackerUp(evt: PointerEvent) {
        window.removeEventListener("pointerup", this.#onTrackerUpLambda);
        window.removeEventListener("pointermove", this.#onTrackerMoveLambda);
        this.lastMargin = parseFloat(this.tracker!.style.marginTop);
    }

    protected onTrackerMove(evt: PointerEvent) {
        let newMargin = evt.pageY - this.trackerY + this.lastMargin;
        if (newMargin < 0) newMargin = 0;
        if (newMargin >= this.trackableHeight) newMargin = this.trackableHeight;
        this.tracker!.style.marginTop = `${newMargin}px`;
        let scrollY = this.extrapolateFactor * newMargin;
        this.scrollTo(scrollY);
    }

    protected onScrollWheel(evt: WheelEvent) {
        let scrollY = 0;
        switch (evt.deltaMode) {
            case WheelEvent.DOM_DELTA_LINE:
                scrollY = evt.deltaY * this.rowHeight;
                break;
            case WheelEvent.DOM_DELTA_PAGE:
                scrollY = evt.deltaY * this.scrollable.clientHeight;
                break;
            case WheelEvent.DOM_DELTA_PIXEL:
                scrollY = evt.deltaY;
                break;
        }

        let deltaMargin = scrollY / this.extrapolateFactor;
        this.lastMargin = deltaMargin + this.lastMargin;
        if (this.lastMargin < 0) this.lastMargin = 0;
        if (this.lastMargin >= this.trackableHeight)
            this.lastMargin = this.trackableHeight;
        this.tracker!.style.marginTop = `${this.lastMargin}px`;
        scrollY = this.extrapolateFactor * this.lastMargin;
        this.scrollTo(scrollY);
    }

    private async scrollTo(scrollY: number) {
        // check if scrollY is within the current page
        let pageNumberByScroll = Math.floor(
            scrollY / (this.overlappingElements * this.rowHeight)
        );
        let pageNumberByPage = this.startPosition / this.overlappingElements;

        if (pageNumberByPage == pageNumberByScroll) {
            // scroll with in the page
            this.scrollable.scrollTo({
                top: scrollY % (this.overlappingElements * this.rowHeight),
            });
        } else if (
            pageNumberByPage + 1 == pageNumberByScroll &&
            this.nextPage != null
        ) {
            // set next page as current
            this.previousPage = this.currentPage;
            this.currentPage = this.nextPage;
            this.startPosition = this.currentPage!.startPosition;
            this.nextPage = await this.requestPageIfExists(
                pageNumberByScroll + 1
            );
            // set the scrollTop offset from the overlapped element
            let top = scrollY % (this.overlappingElements * this.rowHeight);
            this.scrollable.scrollTo({
                top: top,
            });
            this.fillContent();
        } else if (
            pageNumberByPage - 1 == pageNumberByScroll &&
            this.previousPage != null
        ) {
            // set next page as current
            this.nextPage = this.currentPage;
            this.currentPage = this.previousPage;
            this.startPosition = this.currentPage!.startPosition;
            this.previousPage = await this.requestPageIfExists(
                pageNumberByScroll
            );
            // set the scrollTop offset from the overlapped element
            let top = scrollY % (this.overlappingElements * this.rowHeight);
            this.scrollable.scrollTo({
                top: top,
            });
            this.fillContent();
        } else {
            // more than one page is scrolled
            this.updatePages(pageNumberByScroll, scrollY);
        }
    }

    private async updatePages(page: number, scrollY: number) {
        let availableHeight = this.scrollable.clientHeight;

        this.currentPage = await this.requestPageIfExists(page);
        this.startPosition = this.currentPage!.startPosition;
        this.fillContent();

        let trackerHeight = this.calculateTrackerHeight();
        this.trackableHeight = availableHeight - trackerHeight;
        let totalHeight = this.rowHeight * this.currentPage!.numTotalItems;
        this.extrapolateFactor =
            (totalHeight - availableHeight) / this.trackableHeight;

        this.tracker!.style.height = `${trackerHeight}px`;
        let top = scrollY % (this.overlappingElements * this.rowHeight);
        this.scrollable.scrollTo({
            top: top,
        });

        this.nextPage = await this.requestPageIfExists(page + 1);
        this.previousPage = await this.requestPageIfExists(page - 1);
    }

    private calculateEntryHeight(item: T): Promise<number> {
        return new Promise<number>((resolve, _reject) => {
            let elem = this.insertRow!(item);
            this.content!.appendChild(elem);
            requestAnimationFrame(() => {
                resolve(elem.clientHeight);
                this.content!.removeChild(elem);
            });
        });
    }

    private async requestPageIfExists(page: number) {
        if (
            page >= 0 &&
            this.overlappingElements * page <= this.numTotalItems
        ) {
            let num = this.numVisibleItems + this.overlappingElements;
            if (page > 0) num += this.overlappingElements;

            let p = await this.requestPage!(
                page * this.overlappingElements,
                num
            );
            this.numTotalItems = p.numTotalItems;
            return p;
        }
    }

    private calculateTrackerHeight(): number {
        // The trackerheight is the height of the tracker.
        // totalHeight is the height of the all rows
        // if all rows are visible the trackerHeight >= totalHeight.
        // otherwise the tracker should decrease accordingly
        // but it should never be smaller than min height
        let totalHeight = this.rowHeight * this.currentPage!.numTotalItems;
        let visibleHeight = this.scrollable.clientHeight;
        // let scrollableHeight = totalHeight - visibleHeight;

        // The trackableHeight is the height left for the tracker
        // trackableHeight + trackerHeight = visibleHeight
        // The trackableHeight is the normalized scrollableHeight.
        // if normalizeFactor is >= 1 the scrollbar is invisible
        let normalizeFactor = visibleHeight / totalHeight;
        if (normalizeFactor >= 1) return 0;

        let trackerHeight = normalizeFactor * visibleHeight;
        if (trackerHeight < MIN_TRACKER_HEIGHT)
            trackerHeight = MIN_TRACKER_HEIGHT;
        return trackerHeight;
    }

    private fillContent() {
        if (this.currentPage == null) return;

        let fragment = document.createDocumentFragment();
        for (let item of this.currentPage!.items) {
            fragment.appendChild(this.insertRow!(item));
        }
        this.content!.innerHTML = "";
        this.content?.appendChild(fragment);
    }
}

class ListItemImpl implements ListItem {
    constructor(public num: number) {}
}

let element = document.querySelector(".scrollable") as HTMLElement;
let scrollbar = document.querySelector(".scrollbar") as HTMLElement;

let model = new VerticalScrollController<ListItemImpl>(element, scrollbar);
model.initialize(getPage, insertRow, new ListItemImpl(92345));

let totalNumberItems = 500;
function getPage(
    startPosition: number,
    numberItems: number
): Promise<Page<ListItemImpl>> {
    return new Promise<Page<ListItemImpl>>((resolve, _reject) => {
        if (startPosition >= totalNumberItems) return;
        let items: ListItemImpl[] = [];
        for (let idx = 0; idx < numberItems; idx++) {
            if (idx + startPosition >= totalNumberItems) continue;
            items.push(new ListItemImpl(idx + startPosition));
        }
        let page: Page<ListItemImpl> = {
            items: items,
            startPosition: startPosition,
            numTotalItems: totalNumberItems,
        };
        setTimeout(() => {
            resolve(page);
        }, 20);
    });
}

function insertRow(item: ListItemImpl): HTMLElement {
    let elem = document.createElement("div");
    elem.classList.add("row");
    elem.innerHTML = `Element ${item.num}`;
    return elem;
}
