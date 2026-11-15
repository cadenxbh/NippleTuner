import { QMainWindow, QWidget, FlexLayout, QComboBox, QPushButton, QCheckBox, WidgetEventTypes } from "@nodegui/nodegui";
import NipplePreviewWidget from "../widgets/NipplePreviewWidget";
import GraphWidget from "../widgets/GraphWidget";
import SliderWidget from "../widgets/SliderWidget";
import AppMenu from "../menus/AppMenu";

export default class MainWindow extends QMainWindow {
    public previewWidget: NipplePreviewWidget;
    public graphWidget: GraphWidget;
    public presetBox: QComboBox;
    public testButton: QPushButton;
    public saveApplyButton: QPushButton;
    public deadzoneSlider: SliderWidget;
    public sensitivitySlider: SliderWidget;
    public sensXSlider: SliderWidget;
    public sensYSlider: SliderWidget;
    public independentCheck: QCheckBox;
    public menu: AppMenu;
    private rightPanel: QWidget;
    private sensSpacer: QWidget;
    public limitSlider: SliderWidget;
    public stepSlider: SliderWidget;

    constructor() {
        super();

        this.setWindowTitle("NippleTuner");
        this.resize(1100, 720);

        this.menu = new AppMenu();
        this.setMenuBar(this.menu.bar);

        const centralWidget = new QWidget();
        centralWidget.setObjectName("root");
        const layout = new FlexLayout();
        centralWidget.setLayout(layout);

        // Left: nipple preview
        this.previewWidget = new NipplePreviewWidget();
        layout.addWidget(this.previewWidget);

        // Right: curve graph with the preset dropdown underneath
        const rightPanel = new QWidget();
        rightPanel.setObjectName("right-panel");
        const rightLayout = new FlexLayout();
        rightPanel.setLayout(rightLayout);
        this.rightPanel = rightPanel;

        this.graphWidget = new GraphWidget({
            title: "Acceleration curve",
            x: { label: "Input speed (counts/ms)", min: 0 },
            y: { label: "Output speed (counts/ms)", min: 0 },
        });
        rightLayout.addWidget(this.graphWidget);

        // Curve parameter sliders. Speed ranges are set by main once the
        // stick's full scale is known.
        this.deadzoneSlider = new SliderWidget({ label: "Deadzone", min: 0, max: 1, step: 0.05, unit: "c/ms" });
        const sens = { min: 0.1, max: 4, step: 0.05, value: 1, unit: "×" };
        this.sensitivitySlider = new SliderWidget({ label: "Sensitivity", ...sens });
        this.sensXSlider = new SliderWidget({ label: "Sensitivity X", ...sens });
        this.sensYSlider = new SliderWidget({ label: "Sensitivity Y", ...sens });
        this.limitSlider = new SliderWidget({ label: "Limit", min: 0, max: 1, step: 0.05, value: 1, unit: "c/ms" });

        this.independentCheck = new QCheckBox();
        this.independentCheck.setObjectName("independent-check");
        this.independentCheck.setText("Independent X/Y sensitivity");

        rightLayout.addWidget(this.deadzoneSlider);
        rightLayout.addWidget(this.independentCheck);
        rightLayout.addWidget(this.sensitivitySlider);
        // Same height as a slider row; stands in for the second row in linked
        // mode so toggling X/Y never changes the layout.
        this.sensSpacer = new QWidget();
        this.sensSpacer.setObjectName("sens-spacer");
        rightLayout.addWidget(this.sensSpacer);
        rightLayout.addWidget(this.sensXSlider);
        rightLayout.addWidget(this.sensYSlider);
        this.stepSlider = new SliderWidget({ label: "Curve step", min: 0.05, max: 1, step: 0.05, value: 0.2, unit: "c/ms" });
        rightLayout.addWidget(this.limitSlider);
        rightLayout.addWidget(this.stepSlider);

        // Bottom row: preset dropdown, Apply button in the bottom-right corner
        const bottomRow = new QWidget();
        bottomRow.setObjectName("bottom-row");
        const bottomLayout = new FlexLayout();
        bottomRow.setLayout(bottomLayout);

        this.presetBox = new QComboBox();
        this.presetBox.setObjectName("preset-box");
        bottomLayout.addWidget(this.presetBox);

        // Test: try the current (unsaved) settings on the real pointer.
        this.testButton = new QPushButton();
        this.testButton.setObjectName("test-button");
        this.testButton.setText("Test");
        bottomLayout.addWidget(this.testButton);

        // Save & Apply: store as a profile and keep it running.
        this.saveApplyButton = new QPushButton();
        this.saveApplyButton.setObjectName("save-apply-button");
        this.saveApplyButton.setText("Save && Apply");
        bottomLayout.addWidget(this.saveApplyButton);

        rightLayout.addWidget(bottomRow);

        layout.addWidget(rightPanel);

        // Layout only: colours come from the native Qt palette.
        centralWidget.setStyleSheet(`
        #root {
            flex: 1;
            flex-direction: row;
        }
        #nipple-preview {
            flex: 1;
            margin: 8px;
        }
        #right-panel {
            /* width is fixed in code (see constructor) */
            flex-direction: column;
            padding: 8px;
        }
        #graph {
            flex: 1;
        }
        #sens-spacer {
            height: 24px;
            margin-top: 4px;
        }
        #independent-check {
            margin-top: 6px;
        }
        #bottom-row {
            flex-direction: row;
            margin-top: 8px;
        }
        #preset-box {
            flex: 1;
        }
        #test-button, #save-apply-button {
            margin-left: 8px;
            padding: 4px 16px;
        }
        `);

        this.setCentralWidget(centralWidget);

        // Pin the right panel to half the window. Flex sizing is content-based
        // here, so showing/hiding sliders would otherwise move the divider.
        // (yWidth sets the width in the Yoga layout itself; setFixedWidth
        // would only change Qt's size and Yoga would still place it wrong.)
        const pinSplit = () => {
            rightPanel.setProperty("yWidth", String(Math.floor(this.width() / 2)));
            centralWidget.update();
        };
        this.addEventListener(WidgetEventTypes.Resize, pinSplit);
        this.addEventListener(WidgetEventTypes.Show, pinSplit);
        pinSplit();

        this.setIndependentAxes(false);
    }

    /** Shows one shared sensitivity slider, or separate X and Y sliders. */
    public setIndependentAxes(independent: boolean): void {
        this.independentCheck.setChecked(independent);
        // FlexLayout ignores plain hide(), so also set Yoga's display:none
        // (the yDisplay property) to collapse the unused slider(s).
        const set = (w: QWidget, visible: boolean) => {
            w.setProperty("yDisplay", visible ? "flex" : "none");
            w.setVisible(visible);
        };
        set(this.sensitivitySlider, !independent);
        set(this.sensSpacer, !independent);
        set(this.sensXSlider, independent);
        set(this.sensYSlider, independent);
        this.rightPanel.update();
    }

    public get independentAxes(): boolean {
        return this.independentCheck.isChecked();
    }

    public getPreview(): NipplePreviewWidget {
        return this.previewWidget;
    }

    public getGraph(): GraphWidget {
        return this.graphWidget;
    }

    public getPresetBox(): QComboBox {
        return this.presetBox;
    }

    public getTestButton(): QPushButton {
        return this.testButton;
    }
}
