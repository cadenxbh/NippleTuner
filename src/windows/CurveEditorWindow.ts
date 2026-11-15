import { FlexLayout, QComboBox, QLabel, QLineEdit, QMainWindow, QPushButton, QWidget } from "@nodegui/nodegui";
import CurveEditorWidget from "../widgets/CurveEditorWidget";
import CurveLibrary from "../curves/CurveLibrary";
import { CurvePoint } from "../curves/spline";

export interface CurveEditorOptions {
	title: string;
	name: string;
	points: CurvePoint[];
	onSave: (name: string, points: CurvePoint[]) => void;
}

/**
 * Separate window for creating/editing a custom curve: a name field, a
 * "start from" picker that seeds the points from any existing curve, the
 * draggable point editor, and Cancel / Save.
 */
export default class CurveEditorWindow extends QMainWindow {
	private nameEdit: QLineEdit;
	private seedBox: QComboBox;
	private loadButton: QPushButton;
	private editor: CurveEditorWidget;
	private info: QLabel;
	private resetButton: QPushButton;
	private cancelButton: QPushButton;
	private saveButton: QPushButton;
	// Containers are kept as fields so they're never garbage-collected early.
	private parts: (QWidget | FlexLayout)[] = [];
	private initialPoints: CurvePoint[];

	constructor(library: CurveLibrary, opts: CurveEditorOptions) {
		super();
		this.setWindowTitle(opts.title);
		this.resize(520, 640);
		this.initialPoints = opts.points;

		const row = (name: string): [QWidget, FlexLayout] => {
			const w = new QWidget();
			w.setObjectName(name);
			const l = new FlexLayout();
			w.setLayout(l);
			this.parts.push(w, l);
			return [w, l];
		};
		const [root, rootLayout] = row("editor-root");

		// Name
		const [nameRow, nameLayout] = row("editor-row");
		const nameLabel = new QLabel();
		nameLabel.setText("Name");
		nameLabel.setObjectName("editor-label");
		this.nameEdit = new QLineEdit();
		this.nameEdit.setObjectName("editor-input");
		this.nameEdit.setText(opts.name);
		nameLayout.addWidget(nameLabel);
		nameLayout.addWidget(this.nameEdit);

		// Start from
		const [seedRow, seedLayout] = row("editor-row");
		const seedLabel = new QLabel();
		seedLabel.setText("Start from");
		seedLabel.setObjectName("editor-label");
		this.seedBox = new QComboBox();
		this.seedBox.setObjectName("editor-input");
		const seeds = library.all;
		this.seedBox.addItems(seeds.map((c) => (c.builtin ? c.name : `${c.name} (custom)`)));
		this.loadButton = new QPushButton();
		this.loadButton.setText("Load");
		this.loadButton.setObjectName("editor-button");
		this.loadButton.addEventListener("clicked", () => {
			const c = seeds[this.seedBox.currentIndex()];
			if (c) this.setPoints(library.pointsOf(c.id, 9));
		});
		seedLayout.addWidget(seedLabel);
		seedLayout.addWidget(this.seedBox);
		seedLayout.addWidget(this.loadButton);

		// Editor
		this.editor = new CurveEditorWidget();
		this.editor.onChange((pts) => this.updateInfo(pts));

		this.info = new QLabel();
		this.info.setObjectName("editor-info");
		this.info.setWordWrap(true);

		// Buttons
		const [buttons, buttonsLayout] = row("editor-buttons");
		this.resetButton = new QPushButton();
		this.resetButton.setText("Reset");
		this.resetButton.setObjectName("editor-button");
		this.resetButton.addEventListener("clicked", () => this.setPoints(this.initialPoints));
		const [spacer] = row("editor-spacer");
		this.cancelButton = new QPushButton();
		this.cancelButton.setText("Cancel");
		this.cancelButton.setObjectName("editor-button");
		this.cancelButton.addEventListener("clicked", () => this.close());
		this.saveButton = new QPushButton();
		this.saveButton.setText("Save");
		this.saveButton.setObjectName("save-button");
		this.saveButton.addEventListener("clicked", () => {
			opts.onSave(this.nameEdit.text().trim() || "Untitled curve", this.editor.getPoints());
			this.close();
		});
		buttonsLayout.addWidget(this.resetButton);
		buttonsLayout.addWidget(spacer);
		buttonsLayout.addWidget(this.cancelButton);
		buttonsLayout.addWidget(this.saveButton);

		rootLayout.addWidget(nameRow);
		rootLayout.addWidget(seedRow);
		rootLayout.addWidget(this.editor);
		rootLayout.addWidget(this.info);
		rootLayout.addWidget(buttons);
		this.parts.push(nameLabel, seedLabel);

		root.setStyleSheet(`
			#editor-root { flex: 1; flex-direction: column; padding: 10px; }
			#editor-row { flex-direction: row; margin-bottom: 6px; }
			#editor-label { width: 80px; }
			#editor-input { flex: 1; }
			#curve-editor { flex: 1; }
			#editor-info { margin-top: 6px; }
			#editor-buttons { flex-direction: row; margin-top: 8px; }
			#editor-spacer { flex: 1; }
			#editor-button, #save-button { margin-left: 6px; padding: 4px 14px; }
		`);

		this.setCentralWidget(root);
		this.setPoints(opts.points);
	}

	private setPoints(points: CurvePoint[]): void {
		this.editor.setPoints(points);
		this.updateInfo(this.editor.getPoints());
	}

	private updateInfo(points: CurvePoint[]): void {
		this.info.setText(
			`${points.length} points · drag to move · double-click empty space to add · double-click or right-click a point to remove`,
		);
	}
}
