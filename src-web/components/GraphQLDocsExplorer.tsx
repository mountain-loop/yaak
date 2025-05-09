import {
	useAtomValue
} from 'jotai';
import { graphqlSchemaAtom } from "../atoms/graphqlSchemaAtom";
import { Input } from "./core/Input";
import { GraphQLSchema } from "graphql";
import { Button } from "./core/Button";
import { useState } from 'react';
import { IconButton } from "./core/IconButton";

function getRootTypes(graphqlSchema: GraphQLSchema) {
	return {
		query: graphqlSchema.getQueryType(),
		mutation: graphqlSchema.getMutationType(),
		subscription: graphqlSchema.getSubscriptionType(),
	}
}

type Field = NonNullable<ReturnType<GraphQLSchema['getQueryType']>>;
type FieldsMap = ReturnType<Field['getFields']>;

function DocsExplorer({
						  graphqlSchema
					  }: { graphqlSchema: GraphQLSchema }) {
	const rootTypes = getRootTypes(graphqlSchema);
	const [schemaPath, setSchemaPath] = useState('');
	const [schemaPointer, setSchemaPointer] = useState<Field | null>(null);
	const [history, setHistory] = useState<Field[]>([]);

	const goBack = () => {
		if (history.length === 0) {
			return;
		}

		const newHistory = history.slice(0, history.length - 1);
		const newPointer = newHistory[newHistory.length - 1];
		setHistory(newHistory);
		setSchemaPointer(newPointer!);
	}

	const addToHistory = (pointer: Field) => {
		setHistory([...history, pointer]);
	}

	const goHome = () => {
		setHistory([]);
		setSchemaPointer(null);
	}

	const onFieldClick = (field: Field) => {
		setSchemaPointer(field);
		addToHistory(field);
	}

	const renderRootTypes = () => {
		return (
			<div>
				<div>
					{ rootTypes.query
						? <Button
							onClick={ () => {
								setSchemaPath('query');
								setSchemaPointer(rootTypes.query!);
								addToHistory(rootTypes.query!);
							} }
						>Query</Button>
						: null }
				</div>
				<div>{ rootTypes.mutation ? 'Mutation' : null }</div>
				<div>{ rootTypes.subscription ? 'Subscription' : null }</div>
			</div>
		);
	}

	const renderSubFieldRecord = (
		field: FieldsMap[string]
	) => {
		return (
			<div
				className="flex flex-row justify-start items-center"
			>
				<IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add to query"/>
				<div>
					<span>
						{ " " }
					</span>
						<span
							className="text-primary cursor-pointer"
						>
						{ field.name }
					</span>
						{
							field.args.length > 0
								? (
									<>
								<span>
									{ " " }
									(
									{ " " }
								</span>
										{
											field.args.map(
												(x, i, array) => (
													<>
												<span
													key={ x.name }
												>
													<span
														className="text-primary"
													>{ x.name }</span>
													<span>{ " " }</span>
													<span
														className="text-success underline cursor-pointer"
													>{ x.type.toString() }</span>
													{
														i < array.length - 1
															? (
																<>
																	<span>{ " " }</span>
																	<span> , </span>
																	<span>{ " " }</span>
																</>
															)
															: null
													}
												</span>
														<span>{ " " }</span>
													</>
												)
											)
										}
										<span>
									)
								</span>
									</>
								)
								: null
						}
						<span>{ " " }</span>
						<span
							className="text-success underline cursor-pointer"
						>
						{ field.type.toString() }
					</span>
				</div>
			</div>
		);
	};

	const renderSubFields = () => {
		if (!schemaPointer) {
			return null;
		}

		if (!schemaPointer.getFields()) {
			return null;
		}

		return Object.values(schemaPointer.getFields())
			.map(
				(x) => renderSubFieldRecord(x)
			)
	};

	const renderFieldDocView = () => {
		if (!schemaPointer) {
			return null;
		}

		return (
			<div>
				<div
					className="text-primary mt-4"
				>
					{ schemaPointer.name }
				</div>
				<div
					className="my-3"
				>
					Fields
				</div>
				<div
					className="flex flex-col gap-7"
				>
					{ renderSubFields() }
				</div>
			</div>
		)
	}

	const renderExplorerView = () => {
		if (history.length === 0) {
			return renderRootTypes();
		}

		return renderFieldDocView()
	};

	const renderTopBar = () => {
		return (
			<div
				className="flex flex-row gap-2"
			>
				<Button
					onClick={ goBack }
				>
					Back
				</Button>
				<Button
					onClick={ goHome }
				>
					Root
				</Button>
			</div>
		);
	};

	return <div>
		<div
			className="min-h-8"
		>
			{
				history.length > 0
					? renderTopBar()
					: null
			}
		</div>
		<Input
			label="Search docs"
			stateKey="search_graphql_docs"
			placeholder="Search docs"
			hideLabel
		/>
		<div>
			{ renderExplorerView() }
		</div>
	</div>;
}

export function GraphQLDocsExplorer() {
	const graphqlSchema = useAtomValue(graphqlSchemaAtom);

	if (graphqlSchema) {
		return <DocsExplorer graphqlSchema={ graphqlSchema }/>;
	}

	return <div>There is no schema</div>;
}
