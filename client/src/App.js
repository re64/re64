import React, { Component } from 'react';
import logo from './logo.svg';
import { Layout } from 'antd';
import Button from 'antd/lib/button';
import Projects from './components/projects/projects';
import './App.css';

const { Header, Footer, Sider, Content } = Layout;

class App extends Component {
  render() {
    return (
      <div className="App">
        <Layout>
          <Header>Header</Header>
          <Content>
            <div style={{ background: '#fff', padding: 24, minHeight: 280 }}>
              <Projects />
            </div>
          </Content>
          <Footer className="App-footer">
            re64 by Marcus Brinkmann
          </Footer>
        </Layout>
      </div>
    );
  }
}

export default App;
