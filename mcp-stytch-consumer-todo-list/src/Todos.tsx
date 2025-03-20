import { useState, useEffect } from 'react';
import { hc } from 'hono/client'
import {TodoApp} from "../api/TodoAPI.ts";
import {withLoginRequired} from "./Auth.tsx";
import {Todo} from "../types";

const client = hc<TodoApp>(window.location.origin)

const createTodo = (todoText: string)=>
    client.api.todos.$post({json: {todoText}})
        .then(res => res.json())
        .then(res => res.todos)

const getTodos = () =>
    client.api.todos.$get()
        .then(res => res.json())
        .then(res => res.todos)

const deleteTodo = (id: string) =>
    client.api.todos[':id'].$delete({ param: {id}})
    .then(res => res.json())
        .then(res => res.todos)

const markComplete = (id: string) =>
    client.api.todos[':id'].complete.$post({ param: {id}})
        .then(res => res.json())
        .then(res => res.todos)

const TodoEditor = withLoginRequired( () => {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [newTodoText, setNewTodoText] = useState('');

    // Fetch todos on component mount
    useEffect(() => {
        getTodos().then(todos => setTodos(todos));
    }, []);

    const onAddTodo = () => {
        createTodo(newTodoText).then(todos => setTodos(todos));
        setNewTodoText('');
    };

    const onCompleteTodo = (id:string) => {
        markComplete(id).then(todos => setTodos(todos));
    };

    const onDeleteTodo = (id:string) => {
        deleteTodo(id).then(todos => setTodos(todos));
    };

    return (
        <div>
            <input
                type='text'
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
            />
            <button onClick={onAddTodo}>Add TODO</button>
            <ul>
                {todos.map((todo) => (
                    <li key={todo.id}>
                        {todo.completed ? <>✔️ <s>{todo.text}</s></> : todo.text}
                        {!todo.completed && <button onClick={() => onCompleteTodo(todo.id)}>Complete</button>}
                        <button onClick={() => onDeleteTodo(todo.id)}>Delete</button>
                    </li>
                ))}
            </ul>
        </div>
    );
});

export default TodoEditor;